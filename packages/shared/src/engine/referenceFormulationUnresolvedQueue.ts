import { z } from "zod";
import { commercialProductSchema, type CommercialProduct } from "../schemas/commercialProduct";
import { referenceFormulationSourceSchema, type ReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import { supplierDocumentAcquisitionSchema, type SupplierDocumentAcquisition } from "../schemas/supplierDocument";
import {
  referenceFormulationIngredientLineSchema,
  type ReferenceFormulationIngredientLine,
} from "./referenceFormulationIngredientExtraction";
import type { ReferenceFormulationProductMatchingResult } from "./referenceFormulationProductMatching";

export const REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION = "formulab-reference-formulation-unresolved-queue-v1";

export const referenceFormulationUnresolvedEntrySchema = z.object({
  id: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  sourceSupplierId: z.string().trim().min(1),
  ingredientLine: referenceFormulationIngredientLineSchema,
  status: z.enum(["ready_for_acquisition", "ready_for_review"]),
  reasons: z.array(z.enum([
    "product_identity_unmatched",
    "product_identity_ambiguous",
    "fuzzy_match_requires_review",
    "product_match_requires_human_review",
    "supporting_sds_missing",
  ])).min(1),
  candidateCommercialProductIds: z.array(z.string().trim().min(1)),
  supportingSdsDocumentCodes: z.array(z.string().trim().min(1)),
  requestedDocumentKinds: z.array(z.enum(["SDS", "TDS"])).min(1),
  nextActions: z.array(z.enum(["identify_supplier_product", "review_product_candidates", "acquire_supplier_documents"])).min(1),
  reviewRequired: z.literal(true),
}).strict().superRefine((entry, context) => {
  if (entry.ingredientLine.sourceDocumentHash.toLowerCase() !== entry.sourceDocumentHash.toLowerCase()) {
    context.addIssue({ code: "custom", path: ["ingredientLine", "sourceDocumentHash"], message: "Queue entry and source line must reference the same immutable PDF." });
  }
  if (entry.status === "ready_for_acquisition" && !entry.nextActions.includes("acquire_supplier_documents")) {
    context.addIssue({ code: "custom", path: ["nextActions"], message: "Acquisition-ready entries must include supplier document acquisition as a next action." });
  }
});

export type ReferenceFormulationUnresolvedEntry = z.infer<typeof referenceFormulationUnresolvedEntrySchema>;
export interface ReferenceFormulationUnresolvedQueueResult {
  sourceId: string;
  sourceDocumentHash: string;
  queueVersion: typeof REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION;
  /** Full immutable line snapshot; unresolved entries reference these lines without rewriting them. */
  sourceLines: ReferenceFormulationIngredientLine[];
  entries: ReferenceFormulationUnresolvedEntry[];
  reviewRequired: true;
}

function validSdsCodes(candidateProductIds: string[], products: CommercialProduct[], acquisitions: SupplierDocumentAcquisition[], supplierId: string): string[] {
  const candidateProducts = products.filter((product) => candidateProductIds.includes(product.id));
  const linkedCodes = new Set(candidateProducts.flatMap((product) => product.sourceDocumentCodes));
  return acquisitions
    .filter((document) => document.supplierId === supplierId && document.documentType === "SDS" && linkedCodes.has(document.code))
    .map((document) => document.code)
    .sort();
}

/** Keep ungrounded ingredient lines intact and prepare explicit human review/acquisition work; this function performs no acquisition or linking. */
export function buildReferenceFormulationUnresolvedQueue(input: {
  source: ReferenceFormulationSource;
  lines: ReferenceFormulationIngredientLine[];
  matching: ReferenceFormulationProductMatchingResult;
  products: CommercialProduct[];
  supplierDocuments?: SupplierDocumentAcquisition[];
}): ReferenceFormulationUnresolvedQueueResult {
  const source = referenceFormulationSourceSchema.parse(input.source);
  const lines = input.lines.map((line) => referenceFormulationIngredientLineSchema.parse(line));
  const products = input.products.map((product) => commercialProductSchema.parse(product));
  const acquisitions = (input.supplierDocuments ?? []).map((document) => supplierDocumentAcquisitionSchema.parse(document));
  if (input.matching.sourceId !== source.id || input.matching.sourceDocumentHash.toLowerCase() !== source.sourcePdfSha256.toLowerCase()) {
    throw new Error("Product matching result must belong to the same immutable formulation source.");
  }
  if (lines.some((line) => line.sourceDocumentHash.toLowerCase() !== source.sourcePdfSha256.toLowerCase())) {
    throw new Error("Every ingredient line must belong to the same immutable formulation source.");
  }
  for (const line of lines) {
    for (const field of [line.ingredientName, line.supplierProductCode]) {
      if (field && field.evidence.sourceDocumentHash.toLowerCase() !== source.sourcePdfSha256.toLowerCase()) {
        throw new Error("Ingredient queue evidence for line " + line.id + " is linked to a different immutable source PDF.");
      }
    }
  }
  const matchCounts = new Map<string, number>();
  for (const match of input.matching.lines) matchCounts.set(match.ingredientLineId, (matchCounts.get(match.ingredientLineId) ?? 0) + 1);
  if (lines.some((line) => matchCounts.get(line.id) !== 1) || [...matchCounts.keys()].some((lineId) => !lines.some((line) => line.id === lineId))) {
    throw new Error("Product matching result must contain exactly one status for every source ingredient line.");
  }

  const entries: ReferenceFormulationUnresolvedEntry[] = [];
  for (const line of lines) {
    const match = input.matching.lines.find((item) => item.ingredientLineId === line.id)!;
    if (match.autoLinked !== false || match.reviewRequired !== true) {
      throw new Error("Unresolved queue entries must remain unlinked and require human review.");
    }
    if (match.sourceSupplierId !== source.supplierId) throw new Error("Product match supplier must match the immutable formulation source.");
    const candidateIds = [...new Set(match.candidates.map((candidate) => candidate.commercialProductId))];
    if (candidateIds.some((candidateId) => !products.some((product) => product.id === candidateId && product.supplierId === source.supplierId))) {
      throw new Error("Product match candidates must reference a known product from the formulation supplier.");
    }
    const sdsCodes = validSdsCodes(candidateIds, products, acquisitions, source.supplierId);
    const reasons: ReferenceFormulationUnresolvedEntry["reasons"] = [];
    const nextActions: ReferenceFormulationUnresolvedEntry["nextActions"] = [];

    if (match.resolution === "unmatched") {
      reasons.push("product_identity_unmatched");
      nextActions.push("identify_supplier_product");
    } else if (match.resolution === "ambiguous") {
      reasons.push("product_identity_ambiguous");
      nextActions.push("review_product_candidates");
    } else if (match.resolution === "fuzzy_proposal") {
      reasons.push("fuzzy_match_requires_review");
      nextActions.push("review_product_candidates");
    } else {
      reasons.push("product_match_requires_human_review");
      nextActions.push("review_product_candidates");
    }
    if (sdsCodes.length === 0) {
      reasons.push("supporting_sds_missing");
      nextActions.push("acquire_supplier_documents");
    }
    entries.push(referenceFormulationUnresolvedEntrySchema.parse({
      id: source.id + ":unresolved:" + line.id,
      sourceId: source.id,
      sourceDocumentHash: source.sourcePdfSha256,
      sourceSupplierId: source.supplierId,
      ingredientLine: line,
      status: sdsCodes.length === 0 ? "ready_for_acquisition" : "ready_for_review",
      reasons,
      candidateCommercialProductIds: candidateIds,
      supportingSdsDocumentCodes: sdsCodes,
      requestedDocumentKinds: ["SDS", "TDS"],
      nextActions,
      reviewRequired: true,
    }));
  }
  return {
    sourceId: source.id,
    sourceDocumentHash: source.sourcePdfSha256,
    queueVersion: REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION,
    sourceLines: lines,
    entries,
    reviewRequired: true,
  };
}
