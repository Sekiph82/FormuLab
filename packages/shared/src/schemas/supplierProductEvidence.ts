import { z } from "zod";

/**
 * A source-backed supplier-product claim extracted from one immutable SDS or
 * TDS acquisition. This is deliberately separate from RawMaterial: extraction
 * never changes an operational material record.
 */
export const supplierProductClaimEvidenceSchema = z.object({
  id: z.string().trim().min(1),
  fieldCode: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  sectionNumber: z.number().int().min(1).max(16).optional(),
  subject: z.enum(["product", "disclosed_component", "regulatory"]),
  rawValue: z.string().trim().min(1),
  normalizedValue: z.string().trim().min(1).optional(),
  originalUnit: z.string().trim().min(1).optional(),
  normalizedUnit: z.string().trim().min(1).optional(),
  qualifier: z.enum(["specified", "typical", "range", "minimum", "maximum", "recommended", "measured", "unknown"]).default("unknown"),
  basis: z.enum(["as_supplied", "active_matter", "dry_weight", "solution", "unknown"]).default("unknown"),
  context: z.object({
    testMethod: z.string().trim().min(1).optional(),
    temperature: z.string().trim().min(1).optional(),
    sampleConcentration: z.string().trim().min(1).optional(),
    gradeOrVariant: z.string().trim().min(1).optional(),
    conditions: z.string().trim().min(1).optional(),
  }).strict().default({}),
  extraction: z.object({
    method: z.enum(["explicit_label", "table_cell", "ocr", "manual_transcription", "other"]),
    parserVersion: z.string().trim().min(1),
    confidence: z.number().min(0).max(1).optional(),
  }).strict(),
  evidence: z.array(z.object({
    documentHash: z.string().regex(/^[a-f0-9]{64}$/iu),
    pageNumber: z.number().int().positive(),
    lineNumber: z.number().int().positive().optional(),
    excerpt: z.string().trim().min(1),
    source: z.enum(["digital", "ocr", "mixed", "unknown", "manual"]),
    confidence: z.number().min(0).max(1).optional(),
    position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().optional(),
  }).strict()).min(1),
}).strict().superRefine((claim, context) => {
  if (claim.normalizedValue && !claim.normalizedUnit && claim.originalUnit) {
    context.addIssue({ code: "custom", path: ["normalizedUnit"], message: "A normalized value must retain its normalized unit." });
  }
});

export const supplierProductDocumentEvidenceSchema = z.object({
  recordType: z.literal("document"),
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  acquisitionCode: z.string().trim().min(1),
  productCardId: z.string().trim().min(1),
  documentType: z.enum(["SDS", "TDS"]),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/iu),
  parserVersion: z.string().trim().min(1),
  ocrVersion: z.string().trim().min(1).optional(),
  claims: z.array(supplierProductClaimEvidenceSchema),
  reviewStatus: z.literal("unreviewed"),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((record, context) => {
  const ids = record.claims.map((claim) => claim.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["claims"], message: "Claim IDs must be unique within a product evidence snapshot." });
  }
  if (record.claims.some((claim) => claim.evidence.some((source) => source.documentHash.toLowerCase() !== record.documentHash.toLowerCase()))) {
    context.addIssue({ code: "custom", path: ["claims"], message: "Every citation must refer to the exact acquired source document." });
  }
  const allowedFields = record.documentType === "SDS" ? new Set<string>(SDS_PRODUCT_EVIDENCE_FIELDS) : new Set<string>(TDS_PRODUCT_EVIDENCE_FIELDS);
  for (const [index, claim] of record.claims.entries()) {
    if (!allowedFields.has(claim.fieldCode)) {
      context.addIssue({ code: "custom", path: ["claims", index, "fieldCode"], message: `Field ${claim.fieldCode} is not valid for ${record.documentType} evidence.` });
    }
    if (record.documentType === "SDS") {
      const expectedSection = SDS_FIELD_SECTION[claim.fieldCode];
      if (!expectedSection || claim.sectionNumber !== expectedSection) {
        context.addIssue({ code: "custom", path: ["claims", index, "sectionNumber"], message: `SDS field ${claim.fieldCode} must cite Section ${expectedSection ?? "—"}.` });
      }
    }
  }
}).describe("Immutable, unreviewed, citation-rich SDS/TDS product evidence linked to a durable product card; never a RawMaterial update.");

/** Current product-card projection. Each refresh appends a new version so prior
 *  extracted values and the document set that produced them remain auditable. */
export const supplierProductCardVersionSchema = z.object({
  recordType: z.literal("card_version"),
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  productCardId: z.string().trim().min(1),
  version: z.number().int().positive(),
  supplierId: z.string().trim().min(1).optional(),
  supplierName: z.string().trim().min(1).optional(),
  supplierItemCode: z.string().trim().min(1).optional(),
  tradeName: z.string().trim().min(1).optional(),
  grade: z.string().trim().min(1).optional(),
  market: z.string().trim().min(1).default("unknown"),
  language: z.string().trim().min(1).default("unknown"),
  identityStatus: z.enum(["provisional", "review_required", "verified"]).default("provisional"),
  evidenceRecordIds: z.array(z.string().trim().min(1)),
  claimIds: z.array(z.string().trim().min(1)),
  conflicts: z.array(z.object({
    fieldCode: z.string().trim().min(1),
    claimIds: z.array(z.string().trim().min(1)).min(2),
    status: z.literal("review_required"),
  }).strict()),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((card, context) => {
  if (!card.supplierItemCode && !card.tradeName) {
    context.addIssue({ code: "custom", path: ["tradeName"], message: "A product card requires a supplier item code or a trade name." });
  }
  if (new Set(card.evidenceRecordIds).size !== card.evidenceRecordIds.length) {
    context.addIssue({ code: "custom", path: ["evidenceRecordIds"], message: "A product card cannot link the same evidence record twice." });
  }
  if (new Set(card.claimIds).size !== card.claimIds.length) {
    context.addIssue({ code: "custom", path: ["claimIds"], message: "A product card cannot link the same claim twice." });
  }
});

/** Immutable named-human decision on one exact extracted supplier-product
 * claim. The source claim and citation are snapshotted so later extraction
 * revisions cannot silently change what was reviewed. */
export const supplierProductClaimReviewSchema = z.object({
  recordType: z.literal("claim_review"),
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  productCardId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  claimId: z.string().trim().min(1),
  claimSnapshot: supplierProductClaimEvidenceSchema,
  decision: z.enum(["accepted", "rejected", "needs_review"]),
  decisionNote: z.string().trim().min(1).optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewedBy: z.string().trim().min(1),
  reviewerRole: z.string().trim().min(1),
  reviewedAt: z.string().datetime({ offset: true }),
  supersedesReviewId: z.string().trim().min(1).optional(),
}).strict().superRefine((review, context) => {
  if (review.claimSnapshot.id !== review.claimId) {
    context.addIssue({ code: "custom", path: ["claimId"], message: "Review must identify the snapshotted source claim." });
  }
  const expectedRefs = review.claimSnapshot.evidence.map((citation) => `${citation.documentHash}:p${citation.pageNumber}${citation.lineNumber ? `:l${citation.lineNumber}` : ""}`);
  if (review.evidenceRefs.length !== expectedRefs.length
    || review.evidenceRefs.some((reference, index) => reference !== expectedRefs[index])) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Review citations must exactly reference the source claim citations." });
  }
  if (review.decision !== "accepted" && !review.decisionNote) {
    context.addIssue({ code: "custom", path: ["decisionNote"], message: "Rejected and needs-review decisions require a note." });
  }
});

export const supplierProductEvidenceRecordSchema = z.discriminatedUnion("recordType", [
  supplierProductDocumentEvidenceSchema,
  supplierProductCardVersionSchema,
  supplierProductClaimReviewSchema,
]);

export type SupplierProductClaimEvidence = z.infer<typeof supplierProductClaimEvidenceSchema>;
export type SupplierProductDocumentEvidence = z.infer<typeof supplierProductDocumentEvidenceSchema>;
export type SupplierProductCardVersion = z.infer<typeof supplierProductCardVersionSchema>;
export type SupplierProductClaimReview = z.infer<typeof supplierProductClaimReviewSchema>;
export type SupplierProductEvidenceRecord = z.infer<typeof supplierProductEvidenceRecordSchema>;

/** Stable field vocabulary for extraction and resolver mapping. */
export const SDS_PRODUCT_EVIDENCE_FIELDS = [
  "product_identifier", "product_chemical_nature", "product_cas", "product_ec", "supplier_material_number", "product_description",
  "recommended_use", "use_restrictions", "industry_sector", "emergency_contact",
  "substance_or_mixture", "disclosed_component_name", "disclosed_component_cas", "disclosed_component_ec", "disclosed_component_concentration",
  "component_m_factor", "component_specific_concentration_limit", "component_acute_toxicity_estimate", "composition_disclosure", "undisclosed_remainder",
  "handling", "handling_constraints", "storage", "storage_temperature", "storage_conditions", "storage_stability",
  "container_material_compatibility", "sds_shelf_life", "physical_state", "appearance", "color", "odor", "odor_threshold", "ph",
  "density", "relative_density", "viscosity", "solubility", "flash_point", "boiling_point", "melting_point", "freezing_point",
  "melting_freezing_point", "vapor_pressure", "vapor_density", "partition_coefficient", "molecular_weight", "other_physical_property",
  "regulatory_status", "chemical_safety_assessment", "other_regulatory_information",
] as const;

export const TDS_PRODUCT_EVIDENCE_FIELDS = [
  "product_identifier", "active_matter", "total_solids", "nonvolatile_content", "water_content", "density", "relative_density", "ph",
  "viscosity", "ionic_character", "appearance", "color", "odor", "solubility", "recommended_dosage",
  "application_guidance", "application_area", "processing_conditions", "addition_sequence", "compatibility",
  "stability", "storage_conditions", "shelf_life", "packaging", "analytical_method", "cloud_point", "pour_point",
  "flash_point", "performance_claim", "certification_claim",
] as const;

const SDS_FIELD_SECTION: Record<string, number> = {
  product_identifier: 1, product_chemical_nature: 1, product_cas: 1, product_ec: 1, supplier_material_number: 1, product_description: 1,
  recommended_use: 1, use_restrictions: 1, industry_sector: 1, emergency_contact: 1,
  substance_or_mixture: 3, disclosed_component_name: 3, disclosed_component_cas: 3, disclosed_component_ec: 3, disclosed_component_concentration: 3,
  component_m_factor: 3, component_specific_concentration_limit: 3, component_acute_toxicity_estimate: 3, composition_disclosure: 3, undisclosed_remainder: 3,
  handling: 7, handling_constraints: 7, storage: 7, storage_temperature: 7, storage_conditions: 7, storage_stability: 7,
  container_material_compatibility: 7, sds_shelf_life: 7, physical_state: 9, appearance: 9, color: 9, odor: 9, odor_threshold: 9,
  ph: 9, density: 9, relative_density: 9, viscosity: 9, solubility: 9, flash_point: 9, boiling_point: 9,
  melting_point: 9, freezing_point: 9, melting_freezing_point: 9, vapor_pressure: 9, vapor_density: 9, partition_coefficient: 9,
  molecular_weight: 9, other_physical_property: 9, regulatory_status: 15, chemical_safety_assessment: 15, other_regulatory_information: 15,
};
