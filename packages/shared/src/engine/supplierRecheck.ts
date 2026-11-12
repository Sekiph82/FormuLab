import { z } from "zod";

/** Capabilities are explicit provider claims. An undeclared capability is
 * treated as unavailable so an adapter cannot imply incremental coverage. */
export const supplierRecheckCapabilitiesSchema = z.object({
  revision: z.boolean().default(false),
  revisionDate: z.boolean().default(false),
  publicationDate: z.boolean().default(false),
  contentHash: z.boolean().default(false),
  deltaCursor: z.boolean().default(false),
}).strict();
export type SupplierRecheckCapabilities = z.input<typeof supplierRecheckCapabilitiesSchema>;

const supplierRecheckDocumentSchema = z.object({
  documentKey: z.string().trim().min(1),
  sourceRevision: z.string().trim().min(1).optional(),
  revisionDate: z.string().trim().min(1).optional(),
  publicationDate: z.string().trim().min(1).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict();
export type SupplierRecheckDocument = z.infer<typeof supplierRecheckDocumentSchema>;

export type SupplierRecheckDecision = {
  documentKey: string;
  disposition: "unchanged" | "changed" | "fetch_to_compare";
  reason: "revision_match" | "date_match" | "hash_match" | "revision_changed" | "date_changed" | "hash_changed" | "no_comparable_metadata";
};

export interface SupplierRecheckPlan {
  strategy: "provider_delta" | "full_rescan";
  /** Cursor contents are never returned. This is only a presence indicator. */
  usesSecureDeltaCursor: boolean;
  decisions: SupplierRecheckDecision[];
  fullRescanReason?: "provider_delta_cursor_unsupported" | "secure_delta_cursor_unavailable";
}

const secureContinuationRefSchema = z.string().regex(/^formulab-credential:v1:[a-f0-9]{32}$/);

function comparableDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function decideDocument(
  current: SupplierRecheckDocument,
  previous: SupplierRecheckDocument | undefined,
  capabilities: z.output<typeof supplierRecheckCapabilitiesSchema>,
): SupplierRecheckDecision {
  if (!previous) return { documentKey: current.documentKey, disposition: "fetch_to_compare", reason: "no_comparable_metadata" };

  if (capabilities.contentHash && current.sha256 && previous.sha256) {
    if (current.sha256.toLowerCase() === previous.sha256.toLowerCase()) {
      return { documentKey: current.documentKey, disposition: "unchanged", reason: "hash_match" };
    }
    return { documentKey: current.documentKey, disposition: "changed", reason: "hash_changed" };
  }

  if (capabilities.revision && current.sourceRevision && previous.sourceRevision) {
    if (current.sourceRevision === previous.sourceRevision) {
      return { documentKey: current.documentKey, disposition: "unchanged", reason: "revision_match" };
    }
    return { documentKey: current.documentKey, disposition: "changed", reason: "revision_changed" };
  }

  for (const field of ["revisionDate", "publicationDate"] as const) {
    if (!capabilities[field]) continue;
    const currentDate = comparableDate(current[field]);
    const previousDate = comparableDate(previous[field]);
    if (currentDate === undefined || previousDate === undefined) continue;
    if (currentDate === previousDate) {
      return { documentKey: current.documentKey, disposition: "unchanged", reason: "date_match" };
    }
    return { documentKey: current.documentKey, disposition: "changed", reason: "date_changed" };
  }

  return { documentKey: current.documentKey, disposition: "fetch_to_compare", reason: "no_comparable_metadata" };
}

/** Build a conservative supplier recheck plan from explicit provider
 * capabilities and immutable prior acquisition facts. Without a usable
 * declared delta cursor, every scan is reported as a full rescan. */
export function planSupplierRecheck(input: {
  capabilities: SupplierRecheckCapabilities;
  currentDocuments: SupplierRecheckDocument[];
  priorDocuments: SupplierRecheckDocument[];
  secureDeltaCursorRef?: string;
}): SupplierRecheckPlan {
  const capabilities = supplierRecheckCapabilitiesSchema.parse(input.capabilities);
  const currentDocuments = input.currentDocuments.map((document) => supplierRecheckDocumentSchema.parse(document));
  const priorDocuments = input.priorDocuments.map((document) => supplierRecheckDocumentSchema.parse(document));
  if (new Set(currentDocuments.map(({ documentKey }) => documentKey)).size !== currentDocuments.length) {
    throw new Error("Supplier recheck current document keys must be unique.");
  }
  if (new Set(priorDocuments.map(({ documentKey }) => documentKey)).size !== priorDocuments.length) {
    throw new Error("Supplier recheck prior document keys must be unique.");
  }

  const secureCursorAvailable = capabilities.deltaCursor
    && input.secureDeltaCursorRef !== undefined
    && secureContinuationRefSchema.safeParse(input.secureDeltaCursorRef).success;
  const strategy = secureCursorAvailable ? "provider_delta" : "full_rescan";
  const priorByKey = new Map(priorDocuments.map((document) => [document.documentKey, document]));
  const decisions = currentDocuments.map((document) => decideDocument(document, priorByKey.get(document.documentKey), capabilities));

  return {
    strategy,
    usesSecureDeltaCursor: secureCursorAvailable,
    decisions,
    ...(!secureCursorAvailable
      ? { fullRescanReason: capabilities.deltaCursor ? "secure_delta_cursor_unavailable" as const : "provider_delta_cursor_unsupported" as const }
      : {}),
  };
}
