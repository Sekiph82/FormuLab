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
  subject: z.enum(["product", "disclosed_component", "hazard", "transport", "regulatory"]),
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
    source: z.enum(["digital", "ocr", "manual"]),
    confidence: z.number().min(0).max(1).optional(),
    position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().optional(),
  }).strict()).min(1),
}).strict().superRefine((claim, context) => {
  if (claim.normalizedValue && !claim.normalizedUnit && claim.originalUnit) {
    context.addIssue({ code: "custom", path: ["normalizedUnit"], message: "A normalized value must retain its normalized unit." });
  }
});

export const supplierProductDocumentEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  acquisitionCode: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
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
}).describe("Immutable, unreviewed, citation-rich SDS/TDS product evidence; never a RawMaterial update.");

export type SupplierProductClaimEvidence = z.infer<typeof supplierProductClaimEvidenceSchema>;
export type SupplierProductDocumentEvidence = z.infer<typeof supplierProductDocumentEvidenceSchema>;

/** Stable field vocabulary for extraction and resolver mapping. */
export const SDS_PRODUCT_EVIDENCE_FIELDS = [
  "product_identifier", "supplier_identity", "recommended_use", "use_restrictions", "emergency_contact",
  "ghs_classification", "signal_word", "hazard_statement", "precautionary_statement", "pictogram", "other_hazards",
  "substance_or_mixture", "disclosed_component_name", "disclosed_component_cas", "disclosed_component_ec", "disclosed_component_concentration",
  "first_aid", "firefighting", "accidental_release", "handling", "storage", "exposure_limit", "engineering_control",
  "personal_protective_equipment", "physical_state", "appearance", "color", "odor", "ph", "density", "relative_density",
  "viscosity", "solubility", "flash_point", "boiling_point", "melting_point", "vapor_pressure", "reactivity",
  "stability", "incompatible_materials", "hazardous_decomposition", "toxicology", "ecotoxicology", "biodegradability",
  "bioaccumulation", "mobility", "waste_disposal", "un_number", "proper_shipping_name", "transport_hazard_class",
  "packing_group", "environmental_transport_hazard", "regulatory_status", "chemical_safety_assessment", "revision_history",
] as const;

export const TDS_PRODUCT_EVIDENCE_FIELDS = [
  "active_matter", "total_solids", "nonvolatile_content", "water_content", "density", "relative_density", "ph",
  "viscosity", "ionic_character", "appearance", "color", "odor", "solubility", "recommended_dosage",
  "application_guidance", "application_area", "processing_conditions", "addition_sequence", "compatibility",
  "stability", "storage_conditions", "shelf_life", "packaging", "analytical_method", "cloud_point", "pour_point",
  "flash_point", "performance_claim", "certification_claim",
] as const;

const SDS_FIELD_SECTION: Record<string, number> = {
  product_identifier: 1, supplier_identity: 1, recommended_use: 1, use_restrictions: 1, emergency_contact: 1,
  ghs_classification: 2, signal_word: 2, hazard_statement: 2, precautionary_statement: 2, pictogram: 2, other_hazards: 2,
  substance_or_mixture: 3, disclosed_component_name: 3, disclosed_component_cas: 3, disclosed_component_ec: 3, disclosed_component_concentration: 3,
  first_aid: 4, firefighting: 5, accidental_release: 6, handling: 7, storage: 7, exposure_limit: 8,
  engineering_control: 8, personal_protective_equipment: 8, physical_state: 9, appearance: 9, color: 9, odor: 9,
  ph: 9, density: 9, relative_density: 9, viscosity: 9, solubility: 9, flash_point: 9, boiling_point: 9,
  melting_point: 9, vapor_pressure: 9, reactivity: 10, stability: 10, incompatible_materials: 10,
  hazardous_decomposition: 10, toxicology: 11, ecotoxicology: 12, biodegradability: 12, bioaccumulation: 12,
  mobility: 12, waste_disposal: 13, un_number: 14, proper_shipping_name: 14, transport_hazard_class: 14,
  packing_group: 14, environmental_transport_hazard: 14, regulatory_status: 15, chemical_safety_assessment: 15,
  revision_history: 16,
};
