import { z } from "zod";

export const COMMERCIAL_PRODUCT_LIFECYCLE_STATES = ["active", "discontinued", "obsolete", "unknown"] as const;
export const COMMERCIAL_PRODUCT_REVIEW_STATES = ["unreviewed", "needs_review", "accepted", "rejected"] as const;
export const COMMERCIAL_PRODUCT_ALIAS_KINDS = ["trade_name", "product_code", "grade", "other"] as const;

/**
 * A supplier's market-facing product identity. This record deliberately does
 * not contain canonical chemistry: identity resolution is a separate,
 * evidence-backed workflow.
 */
export const commercialProductAliasSchema = z.object({
  value: z.string().trim().min(1).max(240),
  kind: z.enum(COMMERCIAL_PRODUCT_ALIAS_KINDS),
  market: z.string().trim().min(1).max(80).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  sourceDocumentCode: z.string().trim().min(1).optional(),
}).strict();

export const commercialProductFormulationReferenceSchema = z.object({
  sourceFormulationId: z.string().trim().min(1),
  sourceDocumentCode: z.string().trim().min(1),
  sourceLabel: z.string().trim().min(1).max(240).optional(),
}).strict();

/** Keep this as an independent identity/provenance record; never merge it into RawMaterial. */
export const commercialProductSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  supplierId: z.string().trim().min(1),
  tradeName: z.string().trim().min(1).max(240),
  productCode: z.string().trim().min(1).max(160).optional(),
  grade: z.string().trim().min(1).max(160).optional(),
  aliases: z.array(commercialProductAliasSchema).default([]),
  market: z.string().trim().min(1).max(80).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  /** References immutable supplier-document acquisition records; bytes live in the existing document store. */
  sourceDocumentCodes: z.array(z.string().trim().min(1)).default([]),
  sourceFormulationReferences: z.array(commercialProductFormulationReferenceSchema).default([]),
  lifecycleStatus: z.enum(COMMERCIAL_PRODUCT_LIFECYCLE_STATES).default("unknown"),
  reviewStatus: z.enum(COMMERCIAL_PRODUCT_REVIEW_STATES).default("unreviewed"),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((record, context) => {
  if (new Set(record.sourceDocumentCodes).size !== record.sourceDocumentCodes.length) {
    context.addIssue({ code: "custom", path: ["sourceDocumentCodes"], message: "Source document references must be unique." });
  }
  if (record.createdAt && record.updatedAt && Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "Updated time cannot precede created time." });
  }
});

export type CommercialProductAlias = z.infer<typeof commercialProductAliasSchema>;
export type CommercialProductFormulationReference = z.infer<typeof commercialProductFormulationReferenceSchema>;
export type CommercialProduct = z.infer<typeof commercialProductSchema>;
