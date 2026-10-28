import { z } from "zod";
import Decimal from "decimal.js";
import { compositionFractionEvidenceSchema, type CompositionFractionEvidence } from "./compositionFraction";
import { activeMatterEvidenceSchema, type ActiveMatterEvidence } from "./activeMatterEvidence";

export const supplierProductPercentEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  supplierFormulationId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceFormulaLineId: z.string().trim().min(1),
  originalValue: z.string().trim().min(1),
  lowerBoundPercent: z.number().finite().min(0).max(100),
  upperBoundPercent: z.number().finite().min(0).max(100),
  interpretation: z.enum(["exact", "range"]),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((evidence, context) => {
  if (evidence.upperBoundPercent < evidence.lowerBoundPercent
    || (evidence.interpretation === "exact" && evidence.lowerBoundPercent !== evidence.upperBoundPercent)
    || (evidence.interpretation === "range" && evidence.lowerBoundPercent >= evidence.upperBoundPercent)) {
    context.addIssue({ code: "custom", path: ["interpretation"], message: "Supplier product-percent bounds and interpretation are inconsistent." });
  }
  const parsed = parseSupplierPercent(evidence.originalValue);
  if (!parsed || parsed.lowerBound !== evidence.lowerBoundPercent || parsed.upperBound !== evidence.upperBoundPercent) {
    context.addIssue({ code: "custom", path: ["originalValue"], message: "Supplier product-percent bounds must match the cited source value." });
  }
});

export const formulaContributionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  contributionKind: z.enum(["component_contribution", "active_matter_contribution"]),
  supplierFormulationId: z.string().trim().min(1),
  formulaSourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceFormulaLineId: z.string().trim().min(1),
  productPercentEvidenceId: z.string().trim().min(1),
  productPercentEvidenceRefs: z.array(z.string().trim().min(1)).min(1),
  compositionEvidenceId: z.string().trim().min(1),
  compositionSourceEvidenceId: z.string().trim().min(1),
  compositionSourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  compositionSourceFactId: z.string().trim().min(1),
  compositionEvidenceRefs: z.array(z.string().trim().min(1)).min(1),
  productPercentRange: z.object({ lowerBound: z.number().finite().min(0).max(100), upperBound: z.number().finite().min(0).max(100) }).strict(),
  componentFractionRange: z.object({ lowerBound: z.number().finite().min(0).max(1), upperBound: z.number().finite().min(0).max(1) }).strict(),
  contributionPercentRange: z.object({ lowerBound: z.number().finite().min(0).max(100), upperBound: z.number().finite().min(0).max(100), interpretation: z.enum(["exact", "range"]) }).strict(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  reviewRequired: z.literal(true),
}).strict().superRefine((result, context) => {
  if (result.productPercentRange.upperBound < result.productPercentRange.lowerBound
    || result.componentFractionRange.upperBound < result.componentFractionRange.lowerBound
    || result.contributionPercentRange.upperBound < result.contributionPercentRange.lowerBound) {
    context.addIssue({ code: "custom", path: ["contributionPercentRange"], message: "Contribution bounds cannot be descending." });
  }
  if ((result.contributionPercentRange.lowerBound === result.contributionPercentRange.upperBound)
    !== (result.contributionPercentRange.interpretation === "exact")) {
    context.addIssue({ code: "custom", path: ["contributionPercentRange", "interpretation"], message: "Contribution exact/range interpretation must match its bounds." });
  }
  const expectedLower = new Decimal(result.productPercentRange.lowerBound).times(result.componentFractionRange.lowerBound).div(100);
  const expectedUpper = new Decimal(result.productPercentRange.upperBound).times(result.componentFractionRange.upperBound).div(100);
  if (!new Decimal(result.contributionPercentRange.lowerBound).eq(expectedLower)
    || !new Decimal(result.contributionPercentRange.upperBound).eq(expectedUpper)) {
    context.addIssue({ code: "custom", path: ["contributionPercentRange"], message: "Contribution bounds must equal the conservative product-percent by component-fraction calculation." });
  }
  const requiredRefs = [...result.productPercentEvidenceRefs, ...result.compositionEvidenceRefs];
  if (requiredRefs.some((ref) => !result.evidenceRefs.includes(ref))) {
    context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Contribution must retain all product and composition evidence references." });
  }
});

export type SupplierProductPercentEvidence = z.infer<typeof supplierProductPercentEvidenceSchema>;
export type FormulaContribution = z.infer<typeof formulaContributionSchema>;
export type FormulaCompositionEvidence =
  | { kind: "component_fraction"; evidence: CompositionFractionEvidence }
  | { kind: "active_matter"; evidence: ActiveMatterEvidence };

function parseSupplierPercent(rawValue: string): { lowerBound: number; upperBound: number } | undefined {
  const match = rawValue.match(/^\s*(?<lower>\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(?<upper>\d+(?:[.,]\d+)?))?\s*%\s*(?:w\s*\/\s*w)?\s*$/iu);
  if (!match?.groups) return undefined;
  const lowerBound = Number(match.groups.lower!.replace(",", "."));
  const upperBound = Number((match.groups.upper ?? match.groups.lower)!.replace(",", "."));
  return Number.isFinite(lowerBound) && Number.isFinite(upperBound) && lowerBound >= 0 && upperBound <= 100 && upperBound >= lowerBound
    ? { lowerBound, upperBound }
    : undefined;
}

function compositionBounds(composition: FormulaCompositionEvidence): { lowerBound: number; upperBound: number; kind: FormulaContribution["contributionKind"] } {
  if (composition.kind === "component_fraction") {
    const evidence = compositionFractionEvidenceSchema.parse(composition.evidence);
    if (evidence.fraction.interpretation === "unparsed" || evidence.fraction.lowerBound === undefined || evidence.fraction.upperBound === undefined) {
      throw new Error("An unparsed component fraction cannot be used to calculate formula contribution.");
    }
    return { lowerBound: evidence.fraction.lowerBound, upperBound: evidence.fraction.upperBound, kind: "component_contribution" };
  }
  const evidence = activeMatterEvidenceSchema.parse(composition.evidence);
  if (evidence.quantityKind !== "active_matter" || evidence.percent.interpretation === "unparsed"
    || evidence.percent.lowerBound === undefined || evidence.percent.upperBound === undefined) {
    throw new Error("Only explicit parsed active-matter evidence can calculate active-matter contribution.");
  }
  if (evidence.basis !== "as_supplied") {
    throw new Error("Active-matter contribution requires evidence explicitly stated on an as-supplied basis.");
  }
  return { lowerBound: evidence.percent.lowerBound / 100, upperBound: evidence.percent.upperBound / 100, kind: "active_matter_contribution" };
}

/** Calculate the conservative percentage interval; no missing, unparsed or unrelated quantity is inferred. */
export function calculateFormulaContribution(
  productInput: SupplierProductPercentEvidence,
  composition: FormulaCompositionEvidence,
): FormulaContribution {
  const product = supplierProductPercentEvidenceSchema.parse(productInput);
  const compositionBoundsValue = compositionBounds(composition);
  const compositionEvidence = composition.kind === "component_fraction"
    ? compositionFractionEvidenceSchema.parse(composition.evidence)
    : activeMatterEvidenceSchema.parse(composition.evidence);
  if (product.commercialProductId !== compositionEvidence.commercialProductId) {
    throw new Error("Supplier product percentage and composition evidence must reference the same commercial product.");
  }
  const lower = new Decimal(product.lowerBoundPercent).times(compositionBoundsValue.lowerBound).div(100);
  const upper = new Decimal(product.upperBoundPercent).times(compositionBoundsValue.upperBound).div(100);
  const lowerBound = lower.toNumber();
  const upperBound = upper.toNumber();
  const evidenceRefs = [...new Set([...product.evidenceRefs, ...compositionEvidence.evidenceRefs])];
  const contribution: FormulaContribution = {
    schemaVersion: "1.0",
    id: `formula-contribution:${product.id}:${compositionEvidence.id}`,
    commercialProductId: product.commercialProductId,
    contributionKind: compositionBoundsValue.kind,
    supplierFormulationId: product.supplierFormulationId,
    formulaSourceDocumentHash: product.sourceDocumentHash,
    sourceFormulaLineId: product.sourceFormulaLineId,
    productPercentEvidenceId: product.id,
    productPercentEvidenceRefs: product.evidenceRefs,
    compositionEvidenceId: compositionEvidence.id,
    compositionSourceEvidenceId: compositionEvidence.sourceEvidenceId,
    compositionSourceDocumentHash: compositionEvidence.sourceDocumentHash,
    compositionSourceFactId: compositionEvidence.sourceFactId,
    compositionEvidenceRefs: compositionEvidence.evidenceRefs,
    productPercentRange: { lowerBound: product.lowerBoundPercent, upperBound: product.upperBoundPercent },
    componentFractionRange: { lowerBound: compositionBoundsValue.lowerBound, upperBound: compositionBoundsValue.upperBound },
    contributionPercentRange: { lowerBound, upperBound, interpretation: lowerBound === upperBound ? "exact" : "range" },
    evidenceRefs,
    reviewRequired: true,
  };
  return formulaContributionSchema.parse(contribution);
}
