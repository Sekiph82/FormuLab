import { z } from "zod";
import { canonicalChemicalSchema, type CanonicalChemical } from "./canonicalChemical";
import { compareChemicalIdentifierSets } from "./chemicalIdentifiers";
import type { CommercialProductTypeClassification } from "./commercialProductType";
import { reconcileSection1WithSection3Component, supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

export const dominantConcentrationEvidenceSchema = z.object({
  sourceFactId: z.string().trim().min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();

export function parseExplicitMassPercentageRange(rawValue: string): { lowerBound: number; upperBound: number } | undefined {
  const match = rawValue.match(/^\s*(?<lower>\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(?<upper>\d+(?:[.,]\d+)?))?\s*%\s*w\s*\/\s*w\s*$/i);
  if (!match?.groups) return undefined;
  const lowerBound = Number(match.groups.lower!.replace(",", "."));
  const upperBound = Number((match.groups.upper ?? match.groups.lower)!.replace(",", "."));
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound) || upperBound < lowerBound || upperBound > 100) return undefined;
  return { lowerBound, upperBound };
}

export const singleComponentResolutionSchema = z.object({
  status: z.enum(["resolved_candidate", "unresolved", "ambiguous"]),
  commercialProductId: z.string().trim().min(1),
  componentId: z.string().trim().min(1).optional(),
  canonicalChemicalId: z.string().trim().min(1).optional(),
  reasonCodes: z.array(z.string().trim().min(1)).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).default([]),
  reviewRequired: z.literal(true),
}).strict().superRefine((result, context) => {
  if ((result.status === "resolved_candidate") !== Boolean(result.canonicalChemicalId)) {
    context.addIssue({ code: "custom", path: ["canonicalChemicalId"], message: "Only a resolved candidate may carry a canonical chemical ID." });
  }
});

export interface SingleComponentResolverInput {
  source: SupplierSdsProductEvidence;
  productType: CommercialProductTypeClassification;
  concentration: z.input<typeof dominantConcentrationEvidenceSchema>;
  canonicalChemicals: CanonicalChemical[];
}

function unresolved(source: SupplierSdsProductEvidence, reasonCode: string, evidenceRefs: string[] = []): z.infer<typeof singleComponentResolutionSchema> {
  return {
    status: "unresolved",
    commercialProductId: source.commercialProductId,
    reasonCodes: [reasonCode],
    evidenceRefs: [...new Set(evidenceRefs)],
    reviewRequired: true,
  };
}

/** Propose (never approve or write) a single-component canonical chemistry candidate. */
export function resolveSingleComponent(input: SingleComponentResolverInput): z.infer<typeof singleComponentResolutionSchema> {
  const source = supplierSdsProductEvidenceSchema.parse(input.source);
  const concentration = dominantConcentrationEvidenceSchema.parse(input.concentration);
  const canonicalChemicals = input.canonicalChemicals.map((chemical) => canonicalChemicalSchema.parse(chemical));
  const sourceRefs = new Set([
    source.section1.declaredChemicalName,
    source.section1.chemicalNature,
    source.section1.casNumber,
    source.section1.ecNumber,
    source.section1.productDescription,
    source.section3.substanceOrMixture,
    source.section3.undisclosedRemainder,
    ...source.section3.components.flatMap((component) => [component.componentName, component.casNumber, component.ecNumber, component.concentration]),
  ].flatMap((fact) => fact?.evidenceRefs ?? []));
  const evidenceRefs = [...new Set([...sourceRefs, ...input.productType.evidenceRefs, ...concentration.evidenceRefs])];

  if (input.productType.productType !== "PURE_OR_NEAR_PURE") return unresolved(source, "product_not_classified_pure_or_near_pure", evidenceRefs);
  if (!input.productType.evidenceRefs.length || input.productType.evidenceRefs.some((ref) => !sourceRefs.has(ref))) {
    return unresolved(source, "product_type_evidence_not_linked_to_source_record", evidenceRefs);
  }
  if (source.section3.components.length !== 1) return unresolved(source, "not_exactly_one_disclosed_component", evidenceRefs);
  const component = source.section3.components[0]!;
  if (source.section3.undisclosedRemainder || component.disclosure === "trade_secret" || component.disclosure === "withheld") {
    return unresolved(source, "composition_is_partially_or_proprietarily_disclosed", evidenceRefs);
  }
  if (!component.concentration || concentration.sourceFactId !== component.concentration.id) {
    return unresolved(source, "concentration_evidence_not_linked_to_component", evidenceRefs);
  }
  if (!concentration.evidenceRefs.every((ref) => component.concentration!.evidenceRefs.includes(ref))) {
    return unresolved(source, "concentration_citation_mismatch", evidenceRefs);
  }
  const concentrationRange = parseExplicitMassPercentageRange(component.concentration.rawValue);
  if (!concentrationRange || concentrationRange.lowerBound <= 50) {
    return unresolved(source, "concentration_does_not_prove_mass_majority", evidenceRefs);
  }

  const reconciliation = reconcileSection1WithSection3Component(source.section1, component);
  if (reconciliation.outcome !== "consistent") {
    return unresolved(source, reconciliation.outcome === "conflict" ? "section1_section3_identifier_conflict" : "section1_section3_identity_unresolved", [
      ...reconciliation.evidenceRefs,
      ...concentration.evidenceRefs,
      ...input.productType.evidenceRefs,
    ]);
  }
  const section1Identifiers = {
    cas: source.section1.casNumber ? [source.section1.casNumber.rawValue] : [],
    ec: source.section1.ecNumber ? [source.section1.ecNumber.rawValue] : [],
  };
  const componentIdentifiers = {
    cas: component.casNumber ? [component.casNumber.rawValue] : [],
    ec: component.ecNumber ? [component.ecNumber.rawValue] : [],
  };
  const candidates = canonicalChemicals.filter((chemical) => {
    const canonicalIdentifiers = {
      cas: chemical.casIdentifiers.map((identifier) => identifier.originalValue),
      ec: chemical.ecIdentifiers.map((identifier) => identifier.originalValue),
    };
    return compareChemicalIdentifierSets(section1Identifiers, canonicalIdentifiers).status === "compatible"
      && compareChemicalIdentifierSets(componentIdentifiers, canonicalIdentifiers).status === "compatible";
  });
  if (candidates.length === 0) return unresolved(source, "no_canonical_chemical_matches_both_sds_sections", evidenceRefs);
  if (candidates.length > 1) return { status: "ambiguous", commercialProductId: source.commercialProductId, componentId: component.id, reasonCodes: ["multiple_canonical_chemical_matches"], evidenceRefs, reviewRequired: true };
  return {
    status: "resolved_candidate",
    commercialProductId: source.commercialProductId,
    componentId: component.id,
    canonicalChemicalId: candidates[0]!.id,
    reasonCodes: ["single_majority_component_exact_identifier_match"],
    evidenceRefs,
    reviewRequired: true,
  };
}
