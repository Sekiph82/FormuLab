import { z } from "zod";
import Decimal from "decimal.js";
import { createCompositionFractionEvidence } from "./compositionFraction";
import { supplierSdsProductEvidenceRecordSchema, type SupplierSdsProductEvidenceRecord } from "./supplierSdsProductEvidence";
import { parseExplicitMassPercentageRange } from "./singleComponentResolver";
import { referenceFormulationRecordSchema, type ReferenceFormulationRecord } from "./referenceFormulationRecord";

const normalizedPercentBoundsSchema = z.object({
  lowerBound: z.number().finite().min(0).max(100),
  upperBound: z.number().finite().min(0).max(100),
}).strict().superRefine((value, context) => {
  if (value.lowerBound > value.upperBound) context.addIssue({ code: "custom", path: ["upperBound"], message: "Contribution bounds must be ascending." });
});
const normalizedFractionBoundsSchema = z.object({
  lowerBound: z.number().finite().min(0).max(1),
  upperBound: z.number().finite().min(0).max(1),
}).strict().superRefine((value, context) => {
  if (value.lowerBound > value.upperBound) context.addIssue({ code: "custom", path: ["upperBound"], message: "Component fraction bounds must be ascending." });
});

export const referenceFormulationContributionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  quantityKind: z.literal("component_contribution"),
  status: z.enum(["exact", "range", "unknown"]),
  sourceFormulationRecordId: z.string().trim().min(1),
  sourceFormulaDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceFormulaLineId: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1).optional(),
  formulaAmount: z.object({
    originalValue: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    basis: z.string().trim().min(1).optional(),
    interpretation: z.enum(["exact", "range", "unknown"]),
    percentRange: normalizedPercentBoundsSchema.optional(),
    evidenceRefs: z.array(z.string().trim().min(1)),
  }).strict(),
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
    fractionRange: normalizedFractionBoundsSchema.optional(),
    interpretation: z.enum(["exact", "range", "unknown"]),
    evidenceRefs: z.array(z.string().trim().min(1)),
  }).strict(),
  canonicalChemistry: z.object({
    status: z.enum(["unresolved", "proposed", "ambiguous"]),
    candidateIds: z.array(z.string().trim().min(1)),
  }).strict(),
  contributionPercentRange: normalizedPercentBoundsSchema.optional(),
  unknownReasons: z.array(z.enum([
    "formula_amount_missing", "formula_amount_qs", "formula_amount_basis_unknown", "formula_amount_unparsed",
    "sds_evidence_missing", "sds_component_unresolved", "sds_concentration_missing", "sds_concentration_unparsed",
  ])),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewRequired: z.literal(true),
}).strict().superRefine((record, context) => {
  const formula = record.formulaAmount;
  const sds = record.sourceSds;
  if ((record.status === "unknown") !== (record.contributionPercentRange === undefined)) {
    context.addIssue({ code: "custom", path: ["contributionPercentRange"], message: "Only exact or ranged contributions may carry calculated bounds." });
  }
  if ((record.status === "unknown") !== (record.unknownReasons.length > 0)) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Unknown contributions require reasons; calculated contributions cannot carry unknown reasons." });
  }
  if ((formula.interpretation === "unknown") !== (formula.percentRange === undefined)) {
    context.addIssue({ code: "custom", path: ["formulaAmount"], message: "Unknown formula amounts cannot carry normalized percent bounds." });
  }
  if (formula.percentRange && (formula.interpretation === "exact") !== (formula.percentRange.lowerBound === formula.percentRange.upperBound)) {
    context.addIssue({ code: "custom", path: ["formulaAmount", "interpretation"], message: "Formula amount exact/range interpretation must match its bounds." });
  }
  if ((sds.interpretation === "unknown") !== (sds.fractionRange === undefined)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Unknown SDS component fractions cannot carry normalized fraction bounds." });
  }
  if (sds.fractionRange && (sds.interpretation === "exact") !== (sds.fractionRange.lowerBound === sds.fractionRange.upperBound)) {
    context.addIssue({ code: "custom", path: ["sourceSds", "interpretation"], message: "SDS fraction exact/range interpretation must match its bounds." });
  }
  if (sds.status === "missing" && (sds.evidenceId || sds.acquisitionCode || sds.commercialProductId || sds.documentHash || sds.sourceComponentId || sds.disclosure || sds.sourceFactId || sds.originalValue || sds.evidenceRefs.length > 0)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Missing SDS evidence cannot carry source component facts." });
  }
  if (sds.status === "available" && (!sds.evidenceId || !sds.acquisitionCode || !sds.commercialProductId || sds.commercialProductId !== record.commercialProductId || !sds.documentHash || sds.sectionNumber !== 3)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Available composition evidence must identify its persisted SDS record, acquisition, hash and Section 3." });
  }
  if (sds.sourceComponentId && !sds.disclosure) {
    context.addIssue({ code: "custom", path: ["sourceSds", "disclosure"], message: "SDS component disclosure status must be preserved." });
  }
  if (sds.sourceFactId && (!sds.sourceComponentId || !sds.originalValue || sds.evidenceRefs.length === 0)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "SDS concentration facts must retain their component, original value and citations." });
  }
  if (sds.fractionRange && (!sds.sourceFactId || !sds.sourceComponentId || !sds.originalValue || sds.evidenceRefs.length === 0)) {
    context.addIssue({ code: "custom", path: ["sourceSds"], message: "Calculated SDS fractions require the exact source component fact and citations." });
  }
  if ((record.canonicalChemistry.status === "unresolved") !== (record.canonicalChemistry.candidateIds.length === 0)
    || (record.canonicalChemistry.status === "proposed" && record.canonicalChemistry.candidateIds.length !== 1)
    || (record.canonicalChemistry.status === "ambiguous" && record.canonicalChemistry.candidateIds.length < 2)
    || new Set(record.canonicalChemistry.candidateIds).size !== record.canonicalChemistry.candidateIds.length) {
    context.addIssue({ code: "custom", path: ["canonicalChemistry"], message: "Canonical chemistry candidate state must match its unique candidate IDs and remains unaccepted." });
  }
  if (new Set(record.unknownReasons).size !== record.unknownReasons.length) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Unknown contribution reasons must be unique." });
  }
  const formulaUnknownReasonCount = record.unknownReasons.filter((reason) => reason.startsWith("formula_amount_")).length;
  const sdsUnknownReasonCount = record.unknownReasons.filter((reason) => reason.startsWith("sds_")).length;
  if ((formula.interpretation === "unknown") !== (formulaUnknownReasonCount > 0)) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Unknown formula amounts must retain one formula-specific reason." });
  }
  if ((sds.interpretation === "unknown") !== (sdsUnknownReasonCount > 0)) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Unknown SDS composition must retain one SDS-specific reason." });
  }
  if (sds.status === "missing" && !record.unknownReasons.includes("sds_evidence_missing")) {
    context.addIssue({ code: "custom", path: ["unknownReasons"], message: "Missing SDS evidence must be identified as the contribution uncertainty reason." });
  }
  if (record.status !== "unknown" && (formula.percentRange === undefined || sds.fractionRange === undefined)) {
    context.addIssue({ code: "custom", path: ["status"], message: "A calculated contribution requires both formula and SDS component bounds." });
  }
  if (record.status === "unknown" && formula.percentRange !== undefined && sds.fractionRange !== undefined) {
    context.addIssue({ code: "custom", path: ["status"], message: "A contribution with complete formula and SDS bounds cannot remain quantitatively unknown." });
  }
  if (formula.percentRange && (!formula.originalValue || formula.evidenceRefs.length === 0)) {
    context.addIssue({ code: "custom", path: ["formulaAmount"], message: "Calculated formula amounts require their original value and citations." });
  }
  if (record.contributionPercentRange && formula.percentRange && sds.fractionRange) {
    const expectedLower = new Decimal(formula.percentRange.lowerBound).times(sds.fractionRange.lowerBound);
    const expectedUpper = new Decimal(formula.percentRange.upperBound).times(sds.fractionRange.upperBound);
    if (!new Decimal(record.contributionPercentRange.lowerBound).eq(expectedLower)
      || !new Decimal(record.contributionPercentRange.upperBound).eq(expectedUpper)) {
      context.addIssue({ code: "custom", path: ["contributionPercentRange"], message: "Calculated component bounds must equal the cited formula amount multiplied by the SDS mass fraction." });
    }
    if ((record.status === "exact") !== (record.contributionPercentRange.lowerBound === record.contributionPercentRange.upperBound)) {
      context.addIssue({ code: "custom", path: ["status"], message: "Exact/range status must match the calculated bounds." });
    }
  }
  for (const ref of [...formula.evidenceRefs, ...sds.evidenceRefs]) {
    if (!record.evidenceRefs.includes(ref)) context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Contribution must retain all formula and SDS evidence references." });
  }
});

export type ReferenceFormulationContribution = z.infer<typeof referenceFormulationContributionSchema>;

function lineEvidenceRefs(line: ReferenceFormulationRecord["ingredientLines"][number]): string[] {
  return [...new Set([line.ingredientName, line.supplierProductCode, line.inciOrChemicalName, line.amount, line.unit, line.basis]
    .flatMap((field) => field ? [`formula:${field.evidence.sourceDocumentHash}:${field.evidence.pageNumber}:${field.evidence.blockIndex}:${field.evidence.rowIndex}:${field.evidence.cellIndex}`] : []))];
}

type ParsedFormulaAmount = {
  originalValue?: string;
  unit?: string;
  basis?: string;
  interpretation: "exact" | "range" | "unknown";
  percentRange?: { lowerBound: number; upperBound: number };
  evidenceRefs: string[];
  reason?: ReferenceFormulationContribution["unknownReasons"][number];
};

function formulaAmount(line: ReferenceFormulationRecord["ingredientLines"][number]): ParsedFormulaAmount {
  const fieldEvidence = line.amount?.evidence;
  const evidenceRefs = lineEvidenceRefs(line);
  if (!line.amount) return {
    interpretation: "unknown" as const,
    evidenceRefs,
    reason: line.quantitySemantics === "q_s" ? "formula_amount_qs" as const : "formula_amount_missing" as const,
  };
  const amount = line.amount.rawValue;
  if (line.quantitySemantics === "q_s" || /(?:^|\b)(?:q\s*\.?\s*s\.?|qs|quantum\s+satis|quantity\s+sufficient)(?:\b|$)/iu.test(amount)) {
    return {
      originalValue: amount,
      ...(line.unit ? { unit: line.unit.rawValue } : {}),
      ...(line.basis ? { basis: line.basis.rawValue } : {}),
      interpretation: "unknown" as const,
      evidenceRefs,
      reason: "formula_amount_qs" as const,
    };
  }
  let parsed = parseExplicitMassPercentageRange(amount);
  let explicitBasis = Boolean(parsed);
  if (!parsed && line.unit && line.basis) {
    const unit = line.unit.rawValue.trim().toLocaleLowerCase("en-US");
    const basis = line.basis.rawValue.trim().toLocaleLowerCase("en-US");
    if (["%", "percent", "percentage", "wt%", "wt.%"].includes(unit)
      && ["w/w", "weight/weight", "mass/mass", "by weight"].includes(basis)) {
      parsed = parseExplicitMassPercentageRange(`${amount.trim().replace(/%\s*$/u, "")} % w/w`);
      explicitBasis = Boolean(parsed);
    }
  }
  const common = {
    originalValue: amount,
    ...(line.unit ? { unit: line.unit.rawValue } : {}),
    ...(line.basis ? { basis: line.basis.rawValue } : {}),
    evidenceRefs,
  };
  if (!parsed) return {
    ...common,
    interpretation: "unknown" as const,
    reason: !line.unit || !line.basis ? "formula_amount_basis_unknown" as const : "formula_amount_unparsed" as const,
  };
  if (!explicitBasis || !fieldEvidence) return { ...common, interpretation: "unknown" as const, reason: "formula_amount_basis_unknown" as const };
  return {
    ...common,
    interpretation: parsed.lowerBound === parsed.upperBound ? "exact" as const : "range" as const,
    percentRange: { lowerBound: parsed.lowerBound, upperBound: parsed.upperBound },
  };
}

/** Create a source-linked candidate contribution. SDS Section 3 composition stays distinct from active matter. */
export function createReferenceFormulationContribution(input: {
  source: ReferenceFormulationRecord;
  sourceFormulaLineId: string;
  commercialProductId?: string;
  sourceSds?: SupplierSdsProductEvidenceRecord;
  sourceComponentId?: string;
  canonicalChemicalCandidateIds?: string[];
}): ReferenceFormulationContribution {
  const source = referenceFormulationRecordSchema.parse(input.source);
  const line = source.ingredientLines.find((candidate) => candidate.id === input.sourceFormulaLineId);
  if (!line) throw new Error("Contribution source formula line was not found.");
  const productMatch = source.productMatches.find((match) => match.ingredientLineId === line.id);
  const productCandidateIds = productMatch?.candidates.map((candidate) => candidate.commercialProductId) ?? [];
  if (input.commercialProductId && !productCandidateIds.includes(input.commercialProductId)) {
    throw new Error("Contribution commercial product must be a preserved source-line candidate.");
  }
  const sdsRecord = input.sourceSds ? supplierSdsProductEvidenceRecordSchema.parse(input.sourceSds) : undefined;
  const sds = sdsRecord?.evidence;
  if (sds && (!input.commercialProductId || sds.commercialProductId !== input.commercialProductId)) {
    throw new Error("SDS contribution evidence must match the selected source-line commercial-product candidate.");
  }
  if (input.sourceComponentId && !sds) throw new Error("An SDS component cannot be referenced without its source SDS record.");
  const component = sds && input.sourceComponentId
    ? sds.section3.components.find((candidate) => candidate.id === input.sourceComponentId)
    : undefined;
  if (input.sourceComponentId && !component) throw new Error("Contribution source component was not found in the linked SDS.");
  const sourceFraction = component ? createCompositionFractionEvidence(sds!, component.id) : undefined;
  const rawFormulaAmount = formulaAmount(line);
  const unknownReasons: ReferenceFormulationContribution["unknownReasons"] = [];
  if (rawFormulaAmount.interpretation === "unknown" && rawFormulaAmount.reason) unknownReasons.push(rawFormulaAmount.reason);
  if (!sds) unknownReasons.push("sds_evidence_missing");
  else if (!component) unknownReasons.push("sds_component_unresolved");
  else if (!component.concentration) unknownReasons.push("sds_concentration_missing");
  else if (!sourceFraction || sourceFraction.fraction.interpretation === "unparsed") unknownReasons.push("sds_concentration_unparsed");

  const formulaRange = rawFormulaAmount.interpretation === "unknown" ? undefined : rawFormulaAmount.percentRange;
  const fractionRange = sourceFraction?.fraction.interpretation === "unparsed" || !sourceFraction
    ? undefined
    : { lowerBound: sourceFraction.fraction.lowerBound!, upperBound: sourceFraction.fraction.upperBound! };
  const canCalculate = formulaRange !== undefined && fractionRange !== undefined;
  if (canCalculate) unknownReasons.splice(0, unknownReasons.length);
  const contributionRange = canCalculate ? {
    lowerBound: new Decimal(formulaRange.lowerBound).times(fractionRange.lowerBound).toNumber(),
    upperBound: new Decimal(formulaRange.upperBound).times(fractionRange.upperBound).toNumber(),
  } : undefined;
  const sourceSds = sds ? {
    status: "available" as const,
    evidenceId: sdsRecord!.code,
    acquisitionCode: sdsRecord!.acquisitionCode,
    commercialProductId: sds.commercialProductId,
    documentHash: sds.section3.sourceDocumentHash,
    sectionNumber: 3 as const,
    ...(component ? { sourceComponentId: component.id } : {}),
    ...(component ? { disclosure: component.disclosure } : {}),
    ...(component?.concentration ? { sourceFactId: component.concentration.id, originalValue: component.concentration.rawValue } : {}),
    ...(sourceFraction?.fraction.lowerBound !== undefined && sourceFraction.fraction.upperBound !== undefined
      ? { fractionRange: { lowerBound: sourceFraction.fraction.lowerBound, upperBound: sourceFraction.fraction.upperBound } } : {}),
    interpretation: fractionRange ? (fractionRange.lowerBound === fractionRange.upperBound ? "exact" as const : "range" as const) : "unknown" as const,
    evidenceRefs: component ? [...new Set([component.componentName, component.casNumber, component.ecNumber, component.materialNumber, component.concentration]
      .flatMap((fact) => fact?.evidenceRefs ?? []))] : [],
  } : { status: "missing" as const, interpretation: "unknown" as const, evidenceRefs: [] as string[] };
  const canonicalIds = [...new Set(input.canonicalChemicalCandidateIds ?? [])];
  const canonicalChemistry: ReferenceFormulationContribution["canonicalChemistry"] = {
    status: canonicalIds.length === 0 ? "unresolved" : canonicalIds.length === 1 ? "proposed" : "ambiguous",
    candidateIds: canonicalIds,
  };
  return referenceFormulationContributionSchema.parse({
    schemaVersion: "1.0",
    id: `reference-formulation-contribution:${source.id}:${line.id}:${sds?.id ?? "no-sds"}:${component?.id ?? "no-component"}`,
    quantityKind: "component_contribution",
    status: contributionRange ? (contributionRange.lowerBound === contributionRange.upperBound ? "exact" : "range") : "unknown",
    sourceFormulationRecordId: source.id,
    sourceFormulaDocumentHash: source.sourceDocumentHash,
    sourceFormulaLineId: line.id,
    ...(input.commercialProductId ? { commercialProductId: input.commercialProductId } : {}),
    formulaAmount: {
      originalValue: rawFormulaAmount.originalValue,
      unit: rawFormulaAmount.unit,
      basis: rawFormulaAmount.basis,
      interpretation: rawFormulaAmount.interpretation,
      percentRange: rawFormulaAmount.percentRange,
      evidenceRefs: rawFormulaAmount.evidenceRefs.length ? rawFormulaAmount.evidenceRefs : [`formula:${source.sourceDocumentHash}:${line.id}`],
    },
    sourceSds,
    canonicalChemistry,
    ...(contributionRange ? { contributionPercentRange: contributionRange } : {}),
    unknownReasons,
    evidenceRefs: [...new Set([
      ...(rawFormulaAmount.evidenceRefs.length ? rawFormulaAmount.evidenceRefs : [`formula:${source.sourceDocumentHash}:${line.id}`]),
      ...sourceSds.evidenceRefs,
    ])],
    reviewRequired: true,
  });
}

/** Validate formula and SDS lineage, product candidate linkage, and chemistry candidate linkage before accepting a normalized contribution. */
export function validateReferenceFormulationContributionAgainstSource(
  contributionInput: ReferenceFormulationContribution,
  sourceInput: ReferenceFormulationRecord,
  sdsEvidenceRecords: SupplierSdsProductEvidenceRecord[] = [],
): ReferenceFormulationContribution {
  const contribution = referenceFormulationContributionSchema.parse(contributionInput);
  const source = referenceFormulationRecordSchema.parse(sourceInput);
  const line = source.ingredientLines.find((candidate) => candidate.id === contribution.sourceFormulaLineId);
  const match = source.productMatches.find((candidate) => candidate.ingredientLineId === contribution.sourceFormulaLineId);
  if (!line || contribution.sourceFormulationRecordId !== source.id
    || contribution.sourceFormulaDocumentHash.toLowerCase() !== source.sourceDocumentHash.toLowerCase()
    || line.sourceDocumentHash.toLowerCase() !== source.sourceDocumentHash.toLowerCase()) {
    throw new Error("Normalized component contribution must reference the immutable source formulation line and document hash.");
  }
  if (contribution.commercialProductId && !match?.candidates.some((candidate) => candidate.commercialProductId === contribution.commercialProductId)) {
    throw new Error("Normalized component contribution product must remain linked to a preserved source product candidate.");
  }
  if (contribution.sourceSds.status === "available") {
    const evidenceRecord = sdsEvidenceRecords.map((record) => supplierSdsProductEvidenceRecordSchema.parse(record))
      .find((record) => record.code === contribution.sourceSds.evidenceId);
    if (!evidenceRecord
      || evidenceRecord.acquisitionCode !== contribution.sourceSds.acquisitionCode
      || evidenceRecord.evidence.commercialProductId !== contribution.sourceSds.commercialProductId
      || evidenceRecord.evidence.section3.sourceDocumentHash.toLowerCase() !== contribution.sourceSds.documentHash?.toLowerCase()) {
      throw new Error("Normalized component contribution must reference persisted SDS extraction evidence for the same acquisition, product, and document hash.");
    }
    if (contribution.sourceSds.sourceComponentId) {
      const component = evidenceRecord.evidence.section3.components.find((candidate) => candidate.id === contribution.sourceSds.sourceComponentId);
      if (!component || component.disclosure !== contribution.sourceSds.disclosure
        || component.concentration?.id !== contribution.sourceSds.sourceFactId
        || component.concentration?.rawValue !== contribution.sourceSds.originalValue
        || JSON.stringify(component.concentration?.evidenceRefs ?? []) !== JSON.stringify(contribution.sourceSds.evidenceRefs)) {
        throw new Error("Normalized component contribution must retain the persisted SDS component, concentration, disclosure, and citations exactly.");
      }
    } else if (contribution.sourceSds.sourceFactId || contribution.sourceSds.originalValue || contribution.sourceSds.evidenceRefs.length) {
      throw new Error("SDS facts cannot be retained without a persisted component identity.");
    }
  }
  return contribution;
}
