import { z } from "zod";
import type { SupplierSdsPhysicalPropertyCandidate } from "../engine/supplierSdsSection9PhysicalProperties";
import type { SupplierSdsMeasurementContext } from "../engine/supplierSdsMeasurementContext";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

const section9EvidenceSchema = z.object({
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sectionNumber: z.literal(9),
  pageNumber: z.number().int().positive(),
  lineNumber: z.number().int().positive(),
  excerpt: z.string().min(1),
  source: z.enum(["digital", "ocr", "mixed", "unknown"]),
  confidence: z.number().finite().min(0).max(1).optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
}).strict();

const measurementContextSchema = z.object({
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  field: z.string().trim().min(1),
  originalText: z.string().min(1),
  normalizedValue: z.object({
    text: z.string().min(1), status: z.enum(["scalar_normalized", "range_normalized", "text_only"]),
    qualifier: z.enum(["less_than", "less_than_or_equal", "greater_than", "greater_than_or_equal", "approximately"]).optional(),
    value: z.number().finite().optional(), lowerBound: z.number().finite().optional(), upperBound: z.number().finite().optional(), unit: z.string().optional(),
  }).strict(),
  temperature: z.object({ value: z.number().finite(), unit: z.enum(["°C", "°F", "K"]), originalText: z.string().min(1) }).strict().optional(),
  sampleConcentration: z.object({ value: z.number().finite().min(0).max(100), basis: z.literal("percent"), originalText: z.string().min(1) }).strict().optional(),
  deliveredFormBasis: z.enum(["as_supplied", "neat", "active_matter", "dry_basis", "other_explicit", "unspecified"]),
  deliveredFormBasisText: z.string().trim().min(1).optional(),
  methodOrStandard: z.array(z.string().trim().min(1)).optional(),
  claimKind: z.enum(["typical", "specification", "mixed_or_ambiguous", "unspecified"]),
  evidenceKind: z.enum(["measured", "literature", "estimated", "mixed_or_ambiguous", "unspecified"]),
  evidence: z.array(section9EvidenceSchema).min(1),
  reviewRequired: z.literal(true),
}).strict();

type Section9Evidence = z.infer<typeof section9EvidenceSchema>;
function sameSection9Evidence(left: Section9Evidence[], right: Section9Evidence[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other !== undefined
      && item.sourceDocumentHash.toLowerCase() === other.sourceDocumentHash.toLowerCase()
      && item.sectionNumber === other.sectionNumber
      && item.pageNumber === other.pageNumber
      && item.lineNumber === other.lineNumber
      && item.excerpt === other.excerpt
      && item.source === other.source
      && item.confidence === other.confidence
      && item.position?.x === other.position?.x
      && item.position?.y === other.position?.y;
  });
}

export const linkedSupplierPhysicalPropertySchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  parserVersion: z.string().trim().min(1),
  field: z.string().trim().min(1),
  rawValue: z.string().min(1),
  measurementContext: measurementContextSchema,
  evidence: z.array(section9EvidenceSchema).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewRequired: z.literal(true),
}).strict().superRefine((record, context) => {
  if (record.measurementContext.sourceDocumentHash.toLowerCase() !== record.sourceDocumentHash.toLowerCase()) {
    context.addIssue({ code: "custom", path: ["measurementContext", "sourceDocumentHash"], message: "Measurement context must use the linked source document hash." });
  }
  if (record.measurementContext.field !== record.field || record.measurementContext.originalText !== record.rawValue) {
    context.addIssue({ code: "custom", path: ["measurementContext"], message: "Linked property must preserve the candidate field and original value." });
  }
  if (record.measurementContext.normalizedValue.text !== record.measurementContext.originalText.trim().replace(/\s+/gu, " ")) {
    context.addIssue({ code: "custom", path: ["measurementContext", "normalizedValue", "text"], message: "Normalized value text must preserve the original extracted property text." });
  }
  if (!sameSection9Evidence(record.measurementContext.evidence, record.evidence)) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Top-level and measurement-context citations must match exactly." });
  }
  if (record.evidence.some((item) => item.sourceDocumentHash.toLowerCase() !== record.sourceDocumentHash.toLowerCase())) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Physical-property citations must reference the linked SDS document." });
  }
  if (record.evidence.some((item) => !record.evidenceRefs.includes(section9EvidenceRef(item)))) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Linked property must retain each page and line citation." });
  }
});

export type LinkedSupplierPhysicalProperty = z.infer<typeof linkedSupplierPhysicalPropertySchema>;

/** Verify persisted product/source/document links against the immutable SDS identity record. */
export function validateLinkedSupplierPhysicalPropertyAgainstSource(
  recordInput: LinkedSupplierPhysicalProperty,
  sourceInput: SupplierSdsProductEvidence,
): LinkedSupplierPhysicalProperty {
  const record = linkedSupplierPhysicalPropertySchema.parse(recordInput);
  const source = supplierSdsProductEvidenceSchema.parse(sourceInput);
  if (record.commercialProductId !== source.commercialProductId
    || record.sourceEvidenceId !== source.id
    || record.sourceDocumentHash.toLowerCase() !== source.section1.sourceDocumentHash.toLowerCase()
    || record.sourceDocumentHash.toLowerCase() !== source.section3.sourceDocumentHash.toLowerCase()) {
    throw new Error("Linked physical-property lineage does not match its immutable SDS source record.");
  }
  return record;
}

function section9EvidenceRef(evidence: z.infer<typeof section9EvidenceSchema>): string {
  return `sds:${evidence.sourceDocumentHash.toLowerCase()}:section9:p${evidence.pageNumber}:l${evidence.lineNumber}`;
}

/** Link a parser candidate to its commercial product and immutable SDS, retaining all stated conditions. */
export function linkSupplierSdsPhysicalProperty(input: {
  source: SupplierSdsProductEvidence;
  candidate: SupplierSdsPhysicalPropertyCandidate;
  parserVersion: string;
}): LinkedSupplierPhysicalProperty {
  const source = supplierSdsProductEvidenceSchema.parse(input.source);
  const candidate = input.candidate;
  const hash = source.section1.sourceDocumentHash.toLowerCase();
  if (candidate.measurementContext.sourceDocumentHash.toLowerCase() !== hash
    || !candidate.evidence.length
    || candidate.evidence.some((item) => item.sectionNumber !== 9 || item.sourceDocumentHash.toLowerCase() !== hash)) {
    throw new Error("Section 9 candidate must cite the same immutable SDS linked to the commercial product.");
  }
  const evidence = candidate.evidence.map((item) => section9EvidenceSchema.parse(item));
  const record = linkedSupplierPhysicalPropertySchema.parse({
    schemaVersion: "1.0",
    id: `supplier-physical-property:${source.id}:${candidate.field}:${evidence.map((item) => `p${item.pageNumber}l${item.lineNumber}`).join("-")}`,
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    sourceDocumentHash: hash,
    parserVersion: input.parserVersion,
    field: candidate.field,
    rawValue: candidate.rawValue,
    measurementContext: candidate.measurementContext satisfies SupplierSdsMeasurementContext,
    evidence,
    evidenceRefs: [...new Set(evidence.map(section9EvidenceRef))],
    reviewRequired: true,
  });
  return validateLinkedSupplierPhysicalPropertyAgainstSource(record, source);
}
