import { z } from "zod";
import Decimal from "decimal.js";
import { referenceFormulationRecordSchema, type ReferenceFormulationRecord } from "./referenceFormulationRecord";
import {
  createReferenceFormulationFunctionNormalization,
  validateReferenceFormulationFunctionNormalizationAgainstSource,
} from "./referenceFormulationFunction";
import {
  referenceFormulationNormalizationVersionSchema,
  type ReferenceFormulationNormalizationVersion,
  type ReferenceFormulationNormalizationCandidates,
} from "./referenceFormulationNormalization";
import { referenceFormulationProcessNormalizationSchema, createReferenceFormulationProcessNormalization, validateReferenceFormulationProcessNormalizationAgainstSource } from "./referenceFormulationProcessNormalization";
import { referenceFormulationTargetNormalizationSchema, createReferenceFormulationTargetNormalization, validateReferenceFormulationTargetNormalizationAgainstSource } from "./referenceFormulationTargetNormalization";
import { MATERIAL_FUNCTIONS } from "./primitives";

export const REFERENCE_FORMULATION_QUERY_SCHEMA_VERSION = "formulab-reference-formulation-query-v1";

const candidateSetSchema = z.object({
  status: z.enum(["unresolved", "proposed", "ambiguous"]),
  candidateIds: z.array(z.string().trim().min(1)),
  reviewRequired: z.literal(true),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidateIds).size !== value.candidateIds.length
    || (value.status === "unresolved") !== (value.candidateIds.length === 0)
    || (value.status === "proposed" && value.candidateIds.length !== 1)
    || (value.status === "ambiguous" && value.candidateIds.length < 2)) {
    context.addIssue({ code: "custom", path: ["candidateIds"], message: "Query candidates must remain unique and unresolved/proposed/ambiguous." });
  }
});

const productFamilyCandidatesSchema = z.object({
  status: z.enum(["unresolved", "proposed", "ambiguous"]),
  candidates: z.array(z.object({ rawValue: z.string().trim().min(1), evidenceRefs: z.array(z.string().trim().min(1)).min(1) }).strict()),
  reviewRequired: z.literal(true),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidates.map((candidate) => candidate.rawValue.normalize("NFKC").trim().toLocaleLowerCase("en-US"))).size !== value.candidates.length
    || (value.status === "unresolved") !== (value.candidates.length === 0)
    || (value.status === "proposed" && value.candidates.length !== 1)
    || (value.status === "ambiguous" && value.candidates.length < 2)) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Product-family candidate status must match its unique evidence-backed values." });
  }
});

const sourceAmountSchema = z.object({
  originalValue: z.string().trim().min(1).optional(),
  unit: z.string().trim().min(1).optional(),
  basis: z.string().trim().min(1).optional(),
  quantitySemantics: z.enum(["explicit_amount", "q_s", "not_stated"]),
  evidenceRefs: z.array(z.string().trim().min(1)),
}).strict();

const percentBoundsSchema = z.object({
  lowerBound: z.number().finite().min(0).max(100),
  upperBound: z.number().finite().min(0).max(100),
}).strict().superRefine((value, context) => {
  if (value.lowerBound > value.upperBound) context.addIssue({ code: "custom", path: ["upperBound"], message: "Query percentage bounds must be ascending." });
});
const fractionBoundsSchema = z.object({
  lowerBound: z.number().finite().min(0).max(1),
  upperBound: z.number().finite().min(0).max(1),
}).strict().superRefine((value, context) => {
  if (value.lowerBound > value.upperBound) context.addIssue({ code: "custom", path: ["upperBound"], message: "Query component fraction bounds must be ascending." });
});

const queryContributionSchema = z.object({
  contributionId: z.string().trim().min(1),
  status: z.enum(["exact", "range", "unknown"]),
  commercialProductId: z.string().trim().min(1).optional(),
  canonicalChemistry: candidateSetSchema,
  formulaAmount: z.object({
    originalValue: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    basis: z.string().trim().min(1).optional(),
    interpretation: z.enum(["exact", "range", "unknown"]),
    percentRange: percentBoundsSchema.optional(),
    evidenceRefs: z.array(z.string().trim().min(1)),
  }).strict(),
  componentContributionPercentRange: percentBoundsSchema.optional(),
  sourceSds: z.object({
    status: z.enum(["available", "missing"]),
    evidenceId: z.string().trim().min(1).optional(),
    acquisitionCode: z.string().trim().min(1).optional(),
    commercialProductId: z.string().trim().min(1).optional(),
    documentHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    sectionNumber: z.literal(3).optional(),
    sourceComponentId: z.string().trim().min(1).optional(),
    disclosure: z.enum(["disclosed", "trade_secret", "withheld", "unknown"]).optional(),
    sourceFactId: z.string().trim().min(1).optional(),
    originalValue: z.string().trim().min(1).optional(),
    interpretation: z.enum(["exact", "range", "unknown"]),
    fractionRange: fractionBoundsSchema.optional(),
    evidenceRefs: z.array(z.string().trim().min(1)),
  }).strict(),
  unknownReasons: z.array(z.enum([
    "formula_amount_missing", "formula_amount_qs", "formula_amount_basis_unknown", "formula_amount_unparsed",
    "sds_evidence_missing", "sds_component_unresolved", "sds_concentration_missing", "sds_concentration_unparsed",
  ])),
  reviewRequired: z.literal(true),
}).strict().superRefine((value, context) => {
  const formula = value.formulaAmount;
  const sds = value.sourceSds;
  if ((formula.interpretation === "unknown") !== (formula.percentRange === undefined)) {
    context.addIssue({ code: "custom", path: ["formulaAmount"], message: "Unknown formula amounts cannot carry normalized bounds." });
  }
  if (formula.percentRange && (formula.interpretation === "exact") !== (formula.percentRange.lowerBound === formula.percentRange.upperBound)) {
    context.addIssue({ code: "custom", path: ["formulaAmount", "interpretation"], message: "Formula amount interpretation must match its bounds." });
  }
  if ((sds.interpretation === "unknown") !== (sds.fractionRange === undefined)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Unknown SDS fractions cannot carry normalized bounds." });
  }
  if (sds.fractionRange && (sds.interpretation === "exact") !== (sds.fractionRange.lowerBound === sds.fractionRange.upperBound)) {
    context.addIssue({ code: "custom", path: ["sourceSds", "interpretation"], message: "SDS fraction interpretation must match its bounds." });
  }
  if (sds.status === "missing" && (sds.evidenceId || sds.acquisitionCode || sds.commercialProductId || sds.documentHash || sds.sectionNumber !== undefined
    || sds.sourceComponentId || sds.disclosure || sds.sourceFactId || sds.originalValue || sds.fractionRange || sds.evidenceRefs.length)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Missing SDS evidence cannot carry source facts." });
  }
  if (sds.status === "available" && (!sds.evidenceId || !sds.acquisitionCode || !sds.commercialProductId || !sds.documentHash || sds.sectionNumber !== 3)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Available SDS evidence must retain its persisted record, acquisition, product, document hash and Section 3." });
  }
  if (sds.sourceComponentId && !sds.disclosure) context.addIssue({ code: "custom", path: ["sourceSds", "disclosure"], message: "SDS component disclosure must be preserved." });
  if (sds.sourceFactId && (!sds.sourceComponentId || !sds.originalValue || !sds.evidenceRefs.length)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "SDS facts must retain their component, source value and citations." });
  }
  if ((value.status === "unknown") !== (value.componentContributionPercentRange === undefined)) {
    context.addIssue({ code: "custom", path: ["componentContributionPercentRange"], message: "Only calculated contributions can carry contribution bounds." });
  }
  if (value.status !== "unknown" && (!formula.percentRange || !sds.fractionRange)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Calculated contributions require both formula and SDS bounds." });
  }
  if (value.status === "unknown" && value.unknownReasons.length === 0) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Unknown contributions require explicit reasons." });
  }
  if (value.status !== "unknown" && value.unknownReasons.length > 0) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Calculated contributions cannot retain unknown reasons." });
  }
  if (new Set(value.unknownReasons).size !== value.unknownReasons.length) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Unknown contribution reasons must be unique." });
  }
  const formulaReasons = value.unknownReasons.filter((reason) => reason.startsWith("formula_amount_"));
  const sdsReasons = value.unknownReasons.filter((reason) => reason.startsWith("sds_"));
  if ((formula.interpretation === "unknown") !== (formulaReasons.length > 0)) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Formula uncertainty reasons must match formula amount interpretation." });
  }
  if ((sds.interpretation === "unknown") !== (sdsReasons.length > 0)) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "SDS uncertainty reasons must match source fraction interpretation." });
  }
  if (sds.status === "missing" && (!value.unknownReasons.includes("sds_evidence_missing") || sds.interpretation !== "unknown")) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Missing SDS evidence must remain unknown and explain the contribution uncertainty." });
  }
  if (value.componentContributionPercentRange && formula.percentRange && sds.fractionRange) {
    const expectedLower = new Decimal(formula.percentRange.lowerBound).times(sds.fractionRange.lowerBound);
    const expectedUpper = new Decimal(formula.percentRange.upperBound).times(sds.fractionRange.upperBound);
    if (!new Decimal(value.componentContributionPercentRange.lowerBound).eq(expectedLower)
      || !new Decimal(value.componentContributionPercentRange.upperBound).eq(expectedUpper)) {
      context.addIssue({ code: "custom", path: ["componentContributionPercentRange"], message: "Component contribution bounds must equal the cited formula amount multiplied by the SDS fraction." });
    }
    if ((value.status === "exact") !== (value.componentContributionPercentRange.lowerBound === value.componentContributionPercentRange.upperBound)) {
      context.addIssue({ code: "custom", path: ["status"], message: "Exact/range status must match the calculated contribution bounds." });
    }
  }
});

const queryLineSchema = z.object({
  sourceLineId: z.string().trim().min(1),
  sourceIngredientName: z.string().trim().min(1).optional(),
  supplierProductCode: z.string().trim().min(1).optional(),
  inciOrChemicalName: z.string().trim().min(1).optional(),
  sourceLineEvidenceRefs: z.array(z.string().trim().min(1)),
  commercialProducts: candidateSetSchema,
  canonicalChemistry: candidateSetSchema,
  supplierFunction: z.object({
    status: z.enum(["not_stated", "stated"]),
    originalValue: z.string().trim().min(1).optional(),
    evidenceRefs: z.array(z.string().trim().min(1)),
  }).strict().superRefine((value, context) => {
    if (value.status === "stated" && (!value.originalValue || value.evidenceRefs.length === 0)) {
      context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Stated supplier functions require wording and citations." });
    }
    if (value.status === "not_stated" && (value.originalValue !== undefined || value.evidenceRefs.length > 0)) {
      context.addIssue({ code: "custom", path: ["status"], message: "Unstated supplier functions cannot carry wording or citations." });
    }
  }),
  canonicalFunctions: z.object({
    status: z.enum(["unresolved", "proposed", "ambiguous"]),
    candidateIds: z.array(z.enum(MATERIAL_FUNCTIONS)),
    reviewRequired: z.literal(true),
  }).strict().superRefine((value, context) => {
    if (new Set(value.candidateIds).size !== value.candidateIds.length
      || (value.status === "unresolved") !== (value.candidateIds.length === 0)
      || (value.status === "proposed" && value.candidateIds.length !== 1)
      || (value.status === "ambiguous" && value.candidateIds.length < 2)) {
      context.addIssue({ code: "custom", path: ["candidateIds"], message: "Canonical function candidates must be unique and remain unaccepted." });
    }
  }),
  amount: sourceAmountSchema,
  componentContributions: z.array(queryContributionSchema),
  reviewRequired: z.literal(true),
}).strict();

const queryActiveMatterClaimSchema = z.object({
  originalValue: z.string().trim().min(1),
  percentRange: z.object({ lowerBound: z.number().finite().min(0).max(100), upperBound: z.number().finite().min(0).max(100) }).strict().optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewRequired: z.literal(true),
}).strict();

export const referenceFormulationQueryRecordSchema = z.object({
  schemaVersion: z.literal(REFERENCE_FORMULATION_QUERY_SCHEMA_VERSION),
  recordKind: z.literal("reference_formulation_query"),
  id: z.string().trim().min(1),
  sourceRecordId: z.string().trim().min(1),
  normalizationId: z.string().trim().min(1),
  normalizationVersion: z.number().int().positive(),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  supplierId: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  surfaceId: z.string().trim().min(1),
  supplierProduct: z.object({
    tradeName: z.string().trim().min(1).optional(),
    grade: z.string().trim().min(1).optional(),
    supplierItemCode: z.string().trim().min(1).optional(),
  }).strict(),
  formulationTitle: z.string().trim().min(1),
  formulationCode: z.string().trim().min(1).optional(),
  productFamily: productFamilyCandidatesSchema,
  market: z.string().trim().min(1),
  language: z.string().trim().min(1),
  sourceRevision: z.object({
    revisionIdentifier: z.string().trim().min(1).optional(),
    revisionDate: z.string().trim().min(1).optional(),
    publicationDate: z.string().trim().min(1).optional(),
    identityCandidates: z.array(z.object({
      field: z.enum(["revision_identifier", "revision_date", "publication_date", "document_version"]),
      rawValue: z.string().trim().min(1),
      evidenceRefs: z.array(z.string().trim().min(1)).min(1),
      reviewRequired: z.literal(true),
    }).strict()),
  }).strict(),
  lines: z.array(queryLineSchema),
  activeMatterClaims: z.array(queryActiveMatterClaimSchema),
  processSteps: referenceFormulationProcessNormalizationSchema.shape.steps,
  targets: referenceFormulationTargetNormalizationSchema.shape.targets,
  reviewRequired: z.literal(true),
}).strict().superRefine((record, context) => {
  if (new Set(record.lines.map((line) => line.sourceLineId)).size !== record.lines.length) {
    context.addIssue({ code: "custom", path: ["lines"], message: "Query lines must retain unique source line IDs." });
  }
  for (const [index, line] of record.lines.entries()) {
    const contributionProductIds = line.componentContributions.map((contribution) => contribution.commercialProductId).filter((id): id is string => id !== undefined);
    if (contributionProductIds.some((id) => !line.commercialProducts.candidateIds.includes(id))) {
      context.addIssue({ code: "custom", path: ["lines", index, "componentContributions"], message: "Query contribution product IDs must be among the line's source-matched candidates." });
    }
  }
});

export type ReferenceFormulationQueryRecord = z.infer<typeof referenceFormulationQueryRecordSchema>;

function formulaEvidenceRef(hash: string, evidence: { pageNumber: number; blockIndex: number; rowIndex?: number; cellIndex?: number }): string {
  return `formula:${hash}:${evidence.pageNumber}:${evidence.blockIndex}:${evidence.rowIndex ?? "text"}:${evidence.cellIndex ?? "text"}`;
}

function candidateStatus(ids: string[]): ReferenceFormulationNormalizationCandidates["status"] {
  return ids.length === 0 ? "unresolved" : ids.length === 1 ? "proposed" : "ambiguous";
}

/** Build a source-linked, candidate-only query projection; this is not a second material or formula authority. */
export function createReferenceFormulationQueryRecord(input: {
  source: ReferenceFormulationRecord;
  normalization: ReferenceFormulationNormalizationVersion;
}): ReferenceFormulationQueryRecord {
  const source = referenceFormulationRecordSchema.parse(input.source);
  const normalization = referenceFormulationNormalizationVersionSchema.parse(input.normalization);
  if (normalization.referenceFormulationRecordId !== source.id
    || normalization.sourceDocumentHash.toLowerCase() !== source.sourceDocumentHash.toLowerCase()) {
    throw new Error("Query projection must cite the matching immutable source and normalization version.");
  }
  const sourceLineIds = source.ingredientLines.map((line) => line.id);
  const normalizedByLine = new Map(normalization.lines.map((line) => [line.sourceLineId, line]));
  if (normalization.lines.length !== sourceLineIds.length
    || normalizedByLine.size !== sourceLineIds.length
    || sourceLineIds.some((id) => !normalizedByLine.has(id))) {
    throw new Error("Query projection must include every immutable source ingredient line exactly once.");
  }
  const productFamilies = source.identityCandidates.filter((candidate) => candidate.field === "product_family");
  const familyCandidates = new Map<string, { rawValue: string; evidenceRefs: string[] }>();
  for (const candidate of productFamilies) {
    const key = candidate.rawValue.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const evidenceRefs = candidate.evidence.map((evidence) => `identity:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}`);
    const existing = familyCandidates.get(key);
    if (existing) existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...evidenceRefs])];
    else familyCandidates.set(key, { rawValue: candidate.rawValue, evidenceRefs });
  }
  const normalizedFamilies = [...familyCandidates.values()];
  const processNormalization = normalization.processNormalization ?? createReferenceFormulationProcessNormalization(source);
  const targetNormalization = normalization.targetNormalization ?? createReferenceFormulationTargetNormalization(source);
  validateReferenceFormulationProcessNormalizationAgainstSource(processNormalization, source);
  validateReferenceFormulationTargetNormalizationAgainstSource(targetNormalization, source);
  const lines = source.ingredientLines.map((sourceLine) => {
    const normalized = normalizedByLine.get(sourceLine.id)!;
    const functionNormalization = normalized.functionNormalization ?? createReferenceFormulationFunctionNormalization({ source, sourceFormulaLineId: sourceLine.id });
    validateReferenceFormulationFunctionNormalizationAgainstSource(functionNormalization, source, sourceLine.id);
    const sourceMatch = source.productMatches.find((match) => match.ingredientLineId === sourceLine.id);
    const matchIds = sourceMatch?.candidates.map((candidate) => candidate.commercialProductId) ?? [];
    if (JSON.stringify(matchIds) !== JSON.stringify(normalized.commercialProduct.candidateIds)) {
      throw new Error("Query commercial product candidates must match the immutable source matcher snapshot.");
    }
    const amount = sourceLine.amount;
    for (const contribution of normalized.componentContributions) {
      if (contribution.sourceFormulationRecordId !== source.id
        || contribution.sourceFormulaDocumentHash.toLowerCase() !== source.sourceDocumentHash.toLowerCase()
        || contribution.sourceFormulaLineId !== sourceLine.id) {
        throw new Error("Query component contributions must retain matching source formula, document and line identities.");
      }
    }
    return {
      sourceLineId: sourceLine.id,
      ...(sourceLine.ingredientName ? { sourceIngredientName: sourceLine.ingredientName.rawValue } : {}),
      ...(sourceLine.supplierProductCode ? { supplierProductCode: sourceLine.supplierProductCode.rawValue } : {}),
      ...(sourceLine.inciOrChemicalName ? { inciOrChemicalName: sourceLine.inciOrChemicalName.rawValue } : {}),
      sourceLineEvidenceRefs: [sourceLine.ingredientName, sourceLine.supplierProductCode, sourceLine.inciOrChemicalName]
        .filter((field) => field !== undefined)
        .map((field) => formulaEvidenceRef(source.sourceDocumentHash, field.evidence)),
      commercialProducts: { ...normalized.commercialProduct, reviewRequired: true as const },
      canonicalChemistry: { ...normalized.canonicalChemistry, reviewRequired: true as const },
      supplierFunction: functionNormalization.supplierFunction,
      canonicalFunctions: { ...functionNormalization.canonicalFunction, reviewRequired: true as const },
      amount: {
        ...(amount ? { originalValue: amount.rawValue } : {}),
        ...(sourceLine.unit ? { unit: sourceLine.unit.rawValue } : {}),
        ...(sourceLine.basis ? { basis: sourceLine.basis.rawValue } : {}),
        quantitySemantics: sourceLine.quantitySemantics,
        evidenceRefs: [sourceLine.amount, sourceLine.unit, sourceLine.basis]
          .filter((field) => field !== undefined)
          .map((field) => formulaEvidenceRef(source.sourceDocumentHash, field.evidence)),
      },
      componentContributions: normalized.componentContributions.map((contribution) => ({
        contributionId: contribution.id,
        status: contribution.status,
        ...(contribution.commercialProductId ? { commercialProductId: contribution.commercialProductId } : {}),
        canonicalChemistry: { ...contribution.canonicalChemistry, reviewRequired: true as const },
        formulaAmount: {
          ...(contribution.formulaAmount.originalValue ? { originalValue: contribution.formulaAmount.originalValue } : {}),
          ...(contribution.formulaAmount.unit ? { unit: contribution.formulaAmount.unit } : {}),
          ...(contribution.formulaAmount.basis ? { basis: contribution.formulaAmount.basis } : {}),
          interpretation: contribution.formulaAmount.interpretation,
          ...(contribution.formulaAmount.percentRange ? { percentRange: contribution.formulaAmount.percentRange } : {}),
          evidenceRefs: contribution.formulaAmount.evidenceRefs,
        },
        ...(contribution.contributionPercentRange ? { componentContributionPercentRange: contribution.contributionPercentRange } : {}),
        unknownReasons: contribution.unknownReasons,
        sourceSds: {
          status: contribution.sourceSds.status,
          ...(contribution.sourceSds.evidenceId ? { evidenceId: contribution.sourceSds.evidenceId } : {}),
          ...(contribution.sourceSds.acquisitionCode ? { acquisitionCode: contribution.sourceSds.acquisitionCode } : {}),
          ...(contribution.sourceSds.commercialProductId ? { commercialProductId: contribution.sourceSds.commercialProductId } : {}),
          ...(contribution.sourceSds.documentHash ? { documentHash: contribution.sourceSds.documentHash } : {}),
          ...(contribution.sourceSds.sectionNumber !== undefined ? { sectionNumber: contribution.sourceSds.sectionNumber } : {}),
          ...(contribution.sourceSds.sourceComponentId ? { sourceComponentId: contribution.sourceSds.sourceComponentId } : {}),
          ...(contribution.sourceSds.disclosure ? { disclosure: contribution.sourceSds.disclosure } : {}),
          ...(contribution.sourceSds.sourceFactId ? { sourceFactId: contribution.sourceSds.sourceFactId } : {}),
          ...(contribution.sourceSds.originalValue ? { originalValue: contribution.sourceSds.originalValue } : {}),
          interpretation: contribution.sourceSds.interpretation,
          ...(contribution.sourceSds.fractionRange ? { fractionRange: contribution.sourceSds.fractionRange } : {}),
          evidenceRefs: contribution.sourceSds.evidenceRefs,
        },
        reviewRequired: true as const,
      })),
      reviewRequired: true as const,
    };
  });
  return referenceFormulationQueryRecordSchema.parse({
    schemaVersion: REFERENCE_FORMULATION_QUERY_SCHEMA_VERSION,
    recordKind: "reference_formulation_query",
    id: `reference-formulation-query:${source.id}:${normalization.id}`,
    sourceRecordId: source.id,
    normalizationId: normalization.id,
    normalizationVersion: normalization.version,
    sourceDocumentHash: source.sourceDocumentHash,
    supplierId: source.source.supplierId,
    providerId: source.source.providerId,
    surfaceId: source.source.surfaceId,
    supplierProduct: {
      ...(source.source.sourceProduct.tradeName ? { tradeName: source.source.sourceProduct.tradeName } : {}),
      ...(source.source.sourceProduct.grade ? { grade: source.source.sourceProduct.grade } : {}),
      ...(source.source.sourceProduct.supplierItemCode ? { supplierItemCode: source.source.sourceProduct.supplierItemCode } : {}),
    },
    formulationTitle: source.source.title,
    ...(source.source.formulationCode ? { formulationCode: source.source.formulationCode } : {}),
    productFamily: {
      status: candidateStatus(normalizedFamilies.map((candidate) => candidate.rawValue)),
      candidates: normalizedFamilies,
      reviewRequired: true,
    },
    market: source.source.market,
    language: source.source.language,
    sourceRevision: {
      ...(source.source.sourceRevision ? { revisionIdentifier: source.source.sourceRevision } : {}),
      ...(source.source.revisionDate ? { revisionDate: source.source.revisionDate } : {}),
      ...(source.source.publicationDate ? { publicationDate: source.source.publicationDate } : {}),
      identityCandidates: source.identityCandidates
        .filter((candidate) => ["revision_identifier", "revision_date", "publication_date", "document_version"].includes(candidate.field))
        .map((candidate) => ({
          field: candidate.field as "revision_identifier" | "revision_date" | "publication_date" | "document_version",
          rawValue: candidate.rawValue,
          evidenceRefs: candidate.evidence.map((evidence) => `identity:${evidence.sourceDocumentHash}:${evidence.pageNumber}:${evidence.blockIndex}`),
          reviewRequired: true as const,
        })),
    },
    lines,
    // Reference-formula records have no authoritative active-matter claim model; never infer claims from SDS fractions.
    activeMatterClaims: [],
    processSteps: processNormalization.steps,
    targets: targetNormalization.targets,
    reviewRequired: true,
  });
}
