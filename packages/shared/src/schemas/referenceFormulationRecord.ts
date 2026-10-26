import { z } from "zod";
import { REFERENCE_FORMULATION_ARITHMETIC_VERSION, type ReferenceFormulationArithmeticResult } from "../engine/referenceFormulationArithmetic";
import { referenceFormulationIdentityCandidateSchema, REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION } from "../engine/referenceFormulationIdentityExtraction";
import { REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION, referenceFormulationIngredientLineSchema } from "../engine/referenceFormulationIngredientExtraction";
import { REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION, referenceFormulationProcedureStepSchema } from "../engine/referenceFormulationProcedureExtraction";
import { REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION } from "../engine/referenceFormulationProductMatching";
import { REFERENCE_FORMULATION_TARGET_PARSER_VERSION, referenceFormulationTargetCandidateSchema } from "../engine/referenceFormulationTargetExtraction";
import { REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION, referenceFormulationUnresolvedEntrySchema } from "../engine/referenceFormulationUnresolvedQueue";
import { referenceFormulationSourceSchema, type ReferenceFormulationSource } from "./referenceFormulationSource";

const arithmeticSnapshotSchema = z.object({
  sourceId: z.string().trim().min(1),
  acquisitionCode: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  parserVersion: z.literal(REFERENCE_FORMULATION_ARITHMETIC_VERSION),
  sourceDeclaredTotal: z.object({
    rawValue: z.string().trim().min(1),
    unit: z.string().trim().min(1).optional(),
    basis: z.string().trim().min(1).optional(),
    evidence: z.object({
      sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
      pageNumber: z.number().int().positive(),
      blockIndex: z.number().int().nonnegative(),
      excerpt: z.string().trim().min(1),
      source: z.enum(["digital", "ocr", "mixed", "unknown"]),
      confidence: z.number().finite().min(0).max(1).optional(),
    }).strict(),
  }).strict().optional(),
  calculatedTotal: z.object({
    kind: z.enum(["exact", "range"]),
    lowerBound: z.string().regex(/^\d+(?:\.\d+)?$/),
    upperBound: z.string().regex(/^\d+(?:\.\d+)?$/),
    unit: z.literal("% w/w"),
  }).strict().optional(),
  arithmeticStatus: z.enum(["calculated_only", "incomplete", "source_total_not_comparable", "consistent", "overlap", "inconsistent", "no_ingredient_rows"]),
  lineCount: z.number().int().nonnegative(),
  duplicateLineGroups: z.array(z.array(z.string().trim().min(1)).min(2)),
  warnings: z.array(z.enum([
    "no_ingredient_rows", "missing_amount", "q_s_prevents_total", "unknown_unit_or_basis", "invalid_amount_format",
    "percentage_out_of_range", "duplicate_ingredient_rows", "source_total_not_comparable", "source_total_mismatch",
    "source_total_overlap", "ocr_arithmetic_requires_review",
  ])),
  reviewRequired: z.literal(true),
}).strict();

const productMatchCandidateSchema = z.object({
  commercialProductId: z.string().trim().min(1),
  tier: z.enum(["exact", "controlled_alias", "fuzzy_proposal"]),
  matchedOn: z.array(z.enum(["product_code", "trade_name", "alias"])),
  matchedValues: z.array(z.string().trim().min(1)),
  sourceDocumentCodes: z.array(z.string().trim().min(1)),
  similarity: z.number().finite().min(0).max(1).optional(),
}).strict();

const productLineMatchSchema = z.object({
  ingredientLineId: z.string().trim().min(1),
  sourceSupplierId: z.string().trim().min(1),
  resolution: z.enum(["exact_match_candidate", "alias_match_candidate", "fuzzy_proposal", "ambiguous", "unmatched"]),
  candidates: z.array(productMatchCandidateSchema),
  autoLinked: z.literal(false),
  reviewRequired: z.literal(true),
}).strict();

const identityMetadataComparisonSchema = z.object({
  field: z.enum(["revision_identifier", "revision_date", "publication_date"]),
  acquisitionValue: z.string().trim().min(1),
  extractedValues: z.array(z.string().trim().min(1)).min(1),
  result: z.enum(["matches", "differs", "ambiguous"]),
  acquisitionCode: z.string().trim().min(1),
  reviewRequired: z.literal(true),
}).strict();

export const referenceFormulationRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  recordKind: z.literal("supplier_reference_formula"),
  id: z.string().trim().min(1),
  code: z.string().trim().min(1),
  source: referenceFormulationSourceSchema,
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  parserVersions: z.object({
    identity: z.literal(REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION),
    ingredients: z.literal(REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION),
    arithmetic: z.literal(REFERENCE_FORMULATION_ARITHMETIC_VERSION),
    procedure: z.literal(REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION),
    targets: z.literal(REFERENCE_FORMULATION_TARGET_PARSER_VERSION),
    productMatcher: z.literal(REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION),
    unresolvedQueue: z.literal(REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION),
  }).strict(),
  identityCandidates: z.array(referenceFormulationIdentityCandidateSchema),
  identityMetadataComparisons: z.array(identityMetadataComparisonSchema),
  identityWarnings: z.array(z.enum(["no_identity_candidates", "conflicting_identity_candidates", "acquisition_metadata_differs"])),
  ingredientLines: z.array(referenceFormulationIngredientLineSchema),
  arithmetic: arithmeticSnapshotSchema,
  procedureSteps: z.array(referenceFormulationProcedureStepSchema),
  procedureWarnings: z.array(z.enum(["procedure_section_not_detected", "no_procedure_steps", "ambiguous_procedure_columns", "ocr_process_requires_review"])),
  targetCandidates: z.array(referenceFormulationTargetCandidateSchema),
  targetWarnings: z.array(z.enum(["no_target_result_section", "no_target_result_candidates", "ambiguous_property_columns", "ocr_target_results_require_review"])),
  productMatches: z.array(productLineMatchSchema),
  productMatchWarnings: z.array(z.enum(["ambiguous_product_candidates", "fuzzy_matches_are_proposals_only", "unmatched_ingredient_lines", "supplier_products_excluded"])),
  unresolvedEntries: z.array(referenceFormulationUnresolvedEntrySchema),
  reviewStatus: z.literal("unreviewed"),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((record, context) => {
  const hash = record.source.sourcePdfSha256.toLowerCase();
  if (record.sourceDocumentHash.toLowerCase() !== hash) {
    context.addIssue({ code: "custom", path: ["sourceDocumentHash"], message: "Structured reference formula must retain the source snapshot PDF hash." });
  }
  if (record.arithmetic.sourceId !== record.source.id || record.arithmetic.acquisitionCode !== record.source.acquisitionCode || record.arithmetic.sourceDocumentHash.toLowerCase() !== hash) {
    context.addIssue({ code: "custom", path: ["arithmetic"], message: "Arithmetic snapshot must reference the same immutable formulation source." });
  }
  if (record.arithmetic.lineCount !== record.ingredientLines.length) {
    context.addIssue({ code: "custom", path: ["arithmetic", "lineCount"], message: "Arithmetic line count must match preserved source ingredient rows." });
  }
  if (record.arithmetic.sourceDeclaredTotal && record.arithmetic.sourceDeclaredTotal.evidence.sourceDocumentHash.toLowerCase() !== hash) {
    context.addIssue({ code: "custom", path: ["arithmetic", "sourceDeclaredTotal"], message: "Declared total evidence must reference the record's immutable PDF." });
  }
  for (const [index, line] of record.ingredientLines.entries()) {
    if (line.sourceDocumentHash.toLowerCase() !== hash) {
      context.addIssue({ code: "custom", path: ["ingredientLines", index, "sourceDocumentHash"], message: "Ingredient line must reference the record's immutable PDF." });
    }
    const fields = [line.ingredientName, line.supplierProductCode, line.inciOrChemicalName, line.function, line.phase, line.amount, line.unit, line.basis];
    if (fields.some((field) => field && field.evidence.sourceDocumentHash.toLowerCase() !== hash)) {
      context.addIssue({ code: "custom", path: ["ingredientLines", index], message: "Ingredient field evidence must reference the record's immutable PDF." });
    }
  }
  const procedureEvidence = record.procedureSteps.flatMap((step) => [step.evidence, ...step.conditions.map((condition) => condition.evidence)]);
  if (procedureEvidence.some((evidence) => evidence.sourceDocumentHash.toLowerCase() !== hash)) {
    context.addIssue({ code: "custom", path: ["procedureSteps"], message: "Every process fact must reference the record's immutable PDF." });
  }
  if (record.targetCandidates.some((candidate) => candidate.evidence.sourceDocumentHash.toLowerCase() !== hash)) {
    context.addIssue({ code: "custom", path: ["targetCandidates"], message: "Every target/result fact must reference the record's immutable PDF." });
  }
  const lineIds = record.ingredientLines.map((line) => line.id);
  if (new Set(lineIds).size !== lineIds.length) {
    context.addIssue({ code: "custom", path: ["ingredientLines"], message: "Source ingredient line IDs must be unique." });
  }
  const matchIds = record.productMatches.map((match) => match.ingredientLineId);
  if (matchIds.length !== lineIds.length || new Set(matchIds).size !== matchIds.length || lineIds.some((lineId) => !matchIds.includes(lineId))) {
    context.addIssue({ code: "custom", path: ["productMatches"], message: "Every preserved source line must have exactly one review-only product match result." });
  }
  if (record.productMatches.some((match) => match.sourceSupplierId !== record.source.supplierId)) {
    context.addIssue({ code: "custom", path: ["productMatches"], message: "Product match supplier must match the source supplier." });
  }
  if (record.unresolvedEntries.some((entry) => entry.sourceId !== record.source.id || entry.sourceDocumentHash.toLowerCase() !== hash || !lineIds.includes(entry.ingredientLine.id))) {
    context.addIssue({ code: "custom", path: ["unresolvedEntries"], message: "Unresolved entries must point to preserved lines in this source record." });
  }
  const unresolvedLineIds = record.unresolvedEntries.map((entry) => entry.ingredientLine.id);
  if (unresolvedLineIds.length !== lineIds.length || new Set(unresolvedLineIds).size !== unresolvedLineIds.length || lineIds.some((lineId) => !unresolvedLineIds.includes(lineId))) {
    context.addIssue({ code: "custom", path: ["unresolvedEntries"], message: "Each preserved source ingredient line must have exactly one acquisition/review queue entry." });
  }
  const sourceLineById = new Map(record.ingredientLines.map((line) => [line.id, line]));
  const matchByLineId = new Map(record.productMatches.map((match) => [match.ingredientLineId, match]));
  for (const [index, entry] of record.unresolvedEntries.entries()) {
    const sourceLine = sourceLineById.get(entry.ingredientLine.id);
    const match = matchByLineId.get(entry.ingredientLine.id);
    if (sourceLine && JSON.stringify(sourceLine) !== JSON.stringify(entry.ingredientLine)) {
      context.addIssue({ code: "custom", path: ["unresolvedEntries", index, "ingredientLine"], message: "Queued ingredient lines must be unchanged copies of the preserved source line." });
    }
    if (entry.sourceSupplierId !== record.source.supplierId) {
      context.addIssue({ code: "custom", path: ["unresolvedEntries", index, "sourceSupplierId"], message: "Queue supplier must match the immutable formulation source." });
    }
    const matchCandidateIds = match?.candidates.map((candidate) => candidate.commercialProductId).sort() ?? [];
    const queueCandidateIds = [...entry.candidateCommercialProductIds].sort();
    if (JSON.stringify(matchCandidateIds) !== JSON.stringify(queueCandidateIds)) {
      context.addIssue({ code: "custom", path: ["unresolvedEntries", index, "candidateCommercialProductIds"], message: "Queue candidates must exactly match the source line's product-match result." });
    }
    const fields = [entry.ingredientLine.ingredientName, entry.ingredientLine.supplierProductCode];
    if (fields.some((field) => field && field.evidence.sourceDocumentHash.toLowerCase() !== hash)) {
      context.addIssue({ code: "custom", path: ["unresolvedEntries", index, "ingredientLine"], message: "Queued ingredient field evidence must reference the record's immutable PDF." });
    }
  }
  if (record.identityCandidates.some((candidate) => candidate.evidence.some((evidence) => evidence.sourceDocumentHash.toLowerCase() !== hash))) {
    context.addIssue({ code: "custom", path: ["identityCandidates"], message: "Identity evidence must reference the record's immutable PDF." });
  }
  for (const [index, comparison] of record.identityMetadataComparisons.entries()) {
    const sourceValue = comparison.field === "revision_identifier" ? record.source.sourceRevision
      : comparison.field === "revision_date" ? record.source.revisionDate : record.source.publicationDate;
    const candidateValues = record.identityCandidates
      .filter((candidate) => candidate.field === comparison.field)
      .map((candidate) => candidate.rawValue);
    const sortedUnique = (values: string[]) => [...new Set(values.map(comparableMetadata))].sort();
    const distinctValues = sortedUnique(comparison.extractedValues);
    const expectedResult = distinctValues.length > 1 ? "ambiguous"
      : sourceValue !== undefined && distinctValues[0] === comparableMetadata(sourceValue) ? "matches" : "differs";
    if (comparison.acquisitionCode !== record.source.acquisitionCode
      || sourceValue === undefined
      || comparableMetadata(comparison.acquisitionValue) !== comparableMetadata(sourceValue)
      || JSON.stringify(sortedUnique(comparison.extractedValues)) !== JSON.stringify(sortedUnique(candidateValues))
      || comparison.result !== expectedResult) {
      context.addIssue({ code: "custom", path: ["identityMetadataComparisons", index], message: "Identity comparison must be derivable from the source revision metadata and its cited identity candidates." });
    }
  }
});

export type ReferenceFormulationRecord = z.infer<typeof referenceFormulationRecordSchema>;
export type ReferenceFormulationArithmeticSnapshot = z.infer<typeof arithmeticSnapshotSchema>;

function comparableMetadata(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** Build a separate, unreviewed supplier-reference record from the outputs of the V01-05 extraction pipeline. */
export function createReferenceFormulationRecord(input: {
  id: string;
  code: string;
  source: ReferenceFormulationSource;
  identityCandidates: z.input<typeof referenceFormulationIdentityCandidateSchema>[];
  identityMetadataComparisons: ReferenceFormulationRecord["identityMetadataComparisons"];
  identityWarnings: ReferenceFormulationRecord["identityWarnings"];
  ingredientLines: z.input<typeof referenceFormulationIngredientLineSchema>[];
  arithmetic: ReferenceFormulationArithmeticResult;
  procedureSteps: z.input<typeof referenceFormulationProcedureStepSchema>[];
  procedureWarnings: ReferenceFormulationRecord["procedureWarnings"];
  targetCandidates: z.input<typeof referenceFormulationTargetCandidateSchema>[];
  targetWarnings: ReferenceFormulationRecord["targetWarnings"];
  productMatches: ReferenceFormulationRecord["productMatches"];
  productMatchWarnings: ReferenceFormulationRecord["productMatchWarnings"];
  unresolvedEntries: z.input<typeof referenceFormulationUnresolvedEntrySchema>[];
  createdAt: string;
}): ReferenceFormulationRecord {
  return referenceFormulationRecordSchema.parse({
    schemaVersion: "1.0",
    recordKind: "supplier_reference_formula",
    id: input.id,
    code: input.code,
    source: input.source,
    sourceDocumentHash: input.source.sourcePdfSha256,
    parserVersions: {
      identity: REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION,
      ingredients: REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION,
      arithmetic: REFERENCE_FORMULATION_ARITHMETIC_VERSION,
      procedure: REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION,
      targets: REFERENCE_FORMULATION_TARGET_PARSER_VERSION,
      productMatcher: REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION,
      unresolvedQueue: REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION,
    },
    identityCandidates: input.identityCandidates,
    identityMetadataComparisons: input.identityMetadataComparisons,
    identityWarnings: input.identityWarnings,
    ingredientLines: input.ingredientLines,
    arithmetic: input.arithmetic,
    procedureSteps: input.procedureSteps,
    procedureWarnings: input.procedureWarnings,
    targetCandidates: input.targetCandidates,
    targetWarnings: input.targetWarnings,
    productMatches: input.productMatches,
    productMatchWarnings: input.productMatchWarnings,
    unresolvedEntries: input.unresolvedEntries,
    reviewStatus: "unreviewed",
    createdAt: input.createdAt,
  });
}
