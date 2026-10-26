import { z } from "zod";
import { supplierDocumentAcquisitionSchema, type SupplierDocumentAcquisition } from "../schemas/supplierDocument";
import { referenceFormulationLayoutInputSchema, type ReferenceFormulationLayoutInput } from "./referenceFormulationParserContract";

export const REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION = "formulab-reference-formulation-identity-v1";

export const REFERENCE_FORMULATION_IDENTITY_FIELDS = [
  "supplier_name", "application", "product_family", "formulation_title", "formulation_code",
  "revision_identifier", "revision_date", "publication_date", "document_version", "source_identifier",
] as const;

const fieldSchema = z.enum(REFERENCE_FORMULATION_IDENTITY_FIELDS);
const identityEvidenceSchema = z.object({
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  pageNumber: z.number().int().positive(),
  blockIndex: z.number().int().nonnegative(),
  excerpt: z.string().trim().min(1),
  source: z.enum(["digital", "ocr", "mixed", "unknown"]),
  confidence: z.number().finite().min(0).max(1).optional(),
  position: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict().optional(),
}).strict();

export const referenceFormulationIdentityCandidateSchema = z.object({
  field: fieldSchema,
  rawValue: z.string().trim().min(1).max(500),
  extractionMethod: z.enum(["labeled_field", "semantic_heading", "embedded_formulation_code"]),
  evidence: z.array(identityEvidenceSchema).min(1),
  reviewRequired: z.literal(true),
}).strict();

export type ReferenceFormulationIdentityCandidate = z.infer<typeof referenceFormulationIdentityCandidateSchema>;
export type ReferenceFormulationIdentityField = typeof REFERENCE_FORMULATION_IDENTITY_FIELDS[number];

export interface ReferenceFormulationIdentityComparison {
  field: "revision_identifier" | "revision_date" | "publication_date";
  acquisitionValue: string;
  extractedValues: string[];
  result: "matches" | "differs" | "ambiguous";
  acquisitionCode: string;
  reviewRequired: true;
}

export type ReferenceFormulationIdentityWarning = "no_identity_candidates" | "conflicting_identity_candidates" | "acquisition_metadata_differs";

export interface ReferenceFormulationIdentityResult {
  sourceDocumentHash: string;
  acquisitionCode: string;
  supplierId: string;
  parserVersion: typeof REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION;
  candidates: ReferenceFormulationIdentityCandidate[];
  metadataComparisons: ReferenceFormulationIdentityComparison[];
  warnings: ReferenceFormulationIdentityWarning[];
  reviewRequired: true;
}

const LABELS: Record<ReferenceFormulationIdentityField, readonly string[]> = {
  supplier_name: ["supplier", "supplier name", "manufacturer", "manufacturer name"],
  application: ["application", "application area", "use", "market application"],
  product_family: ["product family", "product type", "product category", "application family"],
  formulation_title: ["formulation", "formulation title", "formulation name", "formula title", "formula name", "product name"],
  formulation_code: ["formulation code", "formula code", "recipe code", "formulation no", "formula no"],
  revision_identifier: ["revision", "revision identifier", "revision number", "revision no", "rev"],
  revision_date: ["revision date", "date of revision", "revised on"],
  publication_date: ["publication date", "published", "issue date", "date of issue"],
  document_version: ["document version", "formulation version", "formula version", "version"],
  source_identifier: ["document number", "document no", "document id", "source identifier", "reference number"],
};

function normalizeLabel(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function labeledField(text: string): { field: ReferenceFormulationIdentityField; value: string } | undefined {
  const match = text.match(/^\s*(?<label>[^:：]{1,100})\s*[:：]\s*(?<value>\S[\s\S]*?)\s*$/);
  if (!match?.groups) return undefined;
  const label = normalizeLabel(match.groups.label!);
  const field = (Object.entries(LABELS) as [ReferenceFormulationIdentityField, readonly string[]][])
    .find(([, aliases]) => aliases.some((alias) => normalizeLabel(alias) === label))?.[0];
  return field ? { field, value: match.groups.value! } : undefined;
}

function semanticTitleHeading(text: string): boolean {
  const normalized = normalizeLabel(text);
  return ["formulation title", "formulation name", "formula title", "formula name"].some((label) => normalizeLabel(label) === normalized);
}

function embeddedFormulationIdentity(text: string): { title: string; code: string } | undefined {
  const match = text.trim().match(/^(?<title>.+?)\s+(?<code>[A-Z]{1,8}\/[A-Z]{1,8}\/\d{1,4})$/i);
  if (!match?.groups) return undefined;
  const title = match.groups.title!.trim();
  if (!isSafeSemanticTitleValue(title)) return undefined;
  return { title, code: match.groups.code! };
}

function isSafeSemanticTitleValue(text: string): boolean {
  const value = text.trim();
  return value.length > 2 && !labeledField(value) && !/^\d+(?:\.\d+)*$/.test(value);
}

function comparable(value: string): string {
  return normalizeLabel(value);
}

/** Extract formulation identity candidates without treating printed or acquisition metadata as approved facts. */
export function extractReferenceFormulationIdentity(input: {
  acquisition: SupplierDocumentAcquisition;
  pages: ReferenceFormulationLayoutInput["pages"];
}): ReferenceFormulationIdentityResult {
  const acquisition = supplierDocumentAcquisitionSchema.parse(input.acquisition);
  if (acquisition.documentType !== "FORMULATION") {
    throw new Error("Formulation identity extraction requires a FORMULATION document acquisition.");
  }
  const layoutInput = referenceFormulationLayoutInputSchema.parse({
    sourceDocumentHash: acquisition.sha256,
    pages: input.pages,
    parserVersion: REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION,
  });
  const candidates: ReferenceFormulationIdentityCandidate[] = [];
  const addCandidate = (field: ReferenceFormulationIdentityField, rawValue: string, pageNumber: number, block: z.infer<typeof referenceFormulationLayoutInputSchema>["pages"][number]["blocks"][number], extractionMethod: "labeled_field" | "semantic_heading" | "embedded_formulation_code") => {
    if (!rawValue.trim()) return;
    candidates.push(referenceFormulationIdentityCandidateSchema.parse({
      field,
      rawValue: rawValue.trim(),
      extractionMethod,
      evidence: [{
        sourceDocumentHash: acquisition.sha256,
        pageNumber,
        blockIndex: block.blockIndex,
        excerpt: block.type === "table" ? block.rows.flat().join(" | ") : block.text,
        source: block.source,
        ...(block.confidence !== undefined ? { confidence: block.confidence } : {}),
        ...(block.position ? { position: block.position } : {}),
      }],
      reviewRequired: true,
    }));
  };

  for (const page of layoutInput.pages) {
    const ordered = [...page.blocks].sort((left, right) => left.blockIndex - right.blockIndex);
    ordered.forEach((block, index) => {
      if (block.type === "table") return;
      const labeled = labeledField(block.text);
      if (labeled) addCandidate(labeled.field, labeled.value, page.pageNumber, block, "labeled_field");
      const embedded = embeddedFormulationIdentity(block.text);
      if (embedded) {
        addCandidate("formulation_title", embedded.title, page.pageNumber, block, "embedded_formulation_code");
        addCandidate("formulation_code", embedded.code, page.pageNumber, block, "embedded_formulation_code");
      }
      if (block.type === "heading" && semanticTitleHeading(block.text)) {
        const following = ordered[index + 1];
        if (following?.type === "text" && isSafeSemanticTitleValue(following.text)) {
          addCandidate("formulation_title", following.text, page.pageNumber, following, "semantic_heading");
        }
      }
    });
  }

  const metadataComparisons: ReferenceFormulationIdentityComparison[] = [];
  for (const field of ["revision_identifier", "revision_date", "publication_date"] as const) {
    const acquisitionValue = field === "revision_identifier" ? acquisition.sourceRevision
      : field === "revision_date" ? acquisition.revisionDate : acquisition.publicationDate;
    if (!acquisitionValue) continue;
    const extractedValues = [...new Set(candidates.filter((candidate) => candidate.field === field).map((candidate) => candidate.rawValue))];
    if (extractedValues.length === 0) continue;
    const normalizedValues = new Set(extractedValues.map(comparable));
    const result = normalizedValues.size > 1 ? "ambiguous" as const
      : comparable(extractedValues[0]!) === comparable(acquisitionValue) ? "matches" as const : "differs" as const;
    metadataComparisons.push({ field, acquisitionValue, extractedValues, result, acquisitionCode: acquisition.code, reviewRequired: true });
  }

  const conflictingFields = REFERENCE_FORMULATION_IDENTITY_FIELDS.filter((field) =>
    new Set(candidates.filter((candidate) => candidate.field === field).map((candidate) => comparable(candidate.rawValue))).size > 1,
  );
  const warnings: ReferenceFormulationIdentityWarning[] = [];
  if (candidates.length === 0) warnings.push("no_identity_candidates");
  if (conflictingFields.length > 0 || metadataComparisons.some((item) => item.result === "ambiguous")) warnings.push("conflicting_identity_candidates");
  if (metadataComparisons.some((item) => item.result === "differs" || item.result === "ambiguous")) warnings.push("acquisition_metadata_differs");
  return {
    sourceDocumentHash: acquisition.sha256,
    acquisitionCode: acquisition.code,
    supplierId: acquisition.supplierId,
    parserVersion: REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION,
    candidates,
    metadataComparisons,
    warnings,
    reviewRequired: true,
  };
}
