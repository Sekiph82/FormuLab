import { z } from "zod";
import { canonicalChemicalSchema, type CanonicalChemical } from "./canonicalChemical";
import { compareChemicalIdentifierSets } from "./chemicalIdentifiers";
import type { CommercialProductTypeClassification } from "./commercialProductType";
import { parseExplicitMassPercentageRange } from "./singleComponentResolver";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

export const solutionRoleEvidenceSchema = z.object({
  soluteComponentId: z.string().trim().min(1),
  carrierComponentId: z.string().trim().min(1),
  soluteEvidenceRef: z.string().trim().min(1),
  carrierEvidenceRef: z.string().trim().min(1),
  reviewedBy: z.string().trim().min(1),
}).strict().superRefine((roles, context) => {
  if (roles.soluteComponentId === roles.carrierComponentId) {
    context.addIssue({ code: "custom", path: ["carrierComponentId"], message: "Solute and carrier must be distinct components." });
  }
});

export const solutionResolutionSchema = z.object({
  status: z.enum(["resolved_candidate", "unresolved", "ambiguous"]),
  commercialProductId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  rolesReviewedBy: z.string().trim().min(1),
  soluteComponentId: z.string().trim().min(1).optional(),
  carrierComponentId: z.string().trim().min(1).optional(),
  soluteCanonicalChemicalId: z.string().trim().min(1).optional(),
  compositionDisclosure: z.enum(["partial", "unknown"]),
  disclosureEvidenceRefs: z.array(z.string().trim().min(1)).default([]),
  concentration: z.object({
    originalValue: z.string().min(1),
    lowerBoundPercent: z.number().finite().min(0).max(100),
    upperBoundPercent: z.number().finite().min(0).max(100),
    interpretation: z.enum(["exact", "range"]),
    basis: z.literal("percent_w_w"),
  }).strict().optional(),
  reasonCodes: z.array(z.string().trim().min(1)).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).default([]),
  reviewRequired: z.literal(true),
}).strict().superRefine((result, context) => {
  if (result.status === "resolved_candidate" && (!result.soluteComponentId || !result.carrierComponentId || !result.soluteCanonicalChemicalId || !result.concentration)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Resolved solution candidates require a solute, carrier and source concentration range." });
  }
  if (result.status === "resolved_candidate" && result.concentration
    && result.concentration.upperBoundPercent < result.concentration.lowerBoundPercent) {
    context.addIssue({ code: "custom", path: ["concentration"], message: "Concentration upper bound cannot be below lower bound." });
  }
});

export interface SolutionResolverInput {
  source: SupplierSdsProductEvidence;
  productType: CommercialProductTypeClassification;
  roles: z.input<typeof solutionRoleEvidenceSchema>;
  canonicalChemicals: CanonicalChemical[];
}

/** Represent a reviewed solute/carrier pairing with the exact SDS concentration range; never emit an active-matter value. */
export function resolveSolution(input: SolutionResolverInput): z.infer<typeof solutionResolutionSchema> {
  const source = supplierSdsProductEvidenceSchema.parse(input.source);
  const roles = solutionRoleEvidenceSchema.parse(input.roles);
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
  const evidenceRefs = [...new Set([...sourceRefs, ...input.productType.evidenceRefs, roles.soluteEvidenceRef, roles.carrierEvidenceRef])];
  const disclosureEvidenceRefs = [...new Set([
    source.section3.undisclosedRemainder,
    ...source.section3.components.flatMap((component) => component.disclosure === "trade_secret" || component.disclosure === "withheld"
      ? [component.componentName, component.casNumber, component.ecNumber]
      : []),
  ].flatMap((fact) => fact?.evidenceRefs ?? []))];
  const compositionDisclosure = disclosureEvidenceRefs.length ? "partial" as const : "unknown" as const;
  const unresolved = (reasonCode: string): z.infer<typeof solutionResolutionSchema> => ({
    status: "unresolved",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    rolesReviewedBy: roles.reviewedBy,
    compositionDisclosure,
    disclosureEvidenceRefs,
    reasonCodes: [reasonCode],
    evidenceRefs,
    reviewRequired: true,
  });

  if (input.productType.productType !== "SOLUTION") return unresolved("product_not_classified_as_solution");
  if (!input.productType.evidenceRefs.length || input.productType.evidenceRefs.some((ref) => !sourceRefs.has(ref))) {
    return unresolved("product_type_evidence_not_linked_to_source_record");
  }
  const solute = source.section3.components.find((component) => component.id === roles.soluteComponentId);
  const carrier = source.section3.components.find((component) => component.id === roles.carrierComponentId);
  if (!solute || !carrier) return unresolved("solute_or_carrier_component_not_found");
  const soluteIdentityRefs = [solute.componentName, solute.casNumber, solute.ecNumber].flatMap((fact) => fact?.evidenceRefs ?? []);
  const carrierIdentityRefs = [carrier.componentName, carrier.casNumber, carrier.ecNumber].flatMap((fact) => fact?.evidenceRefs ?? []);
  if (!soluteIdentityRefs.includes(roles.soluteEvidenceRef) || !carrierIdentityRefs.includes(roles.carrierEvidenceRef)) {
    return unresolved("solute_or_carrier_role_evidence_not_linked");
  }
  if (solute.disclosure === "trade_secret" || solute.disclosure === "withheld" || !solute.casNumber && !solute.ecNumber) {
    return unresolved("solute_identity_not_disclosed");
  }
  if (carrier.disclosure === "trade_secret" || carrier.disclosure === "withheld" || !carrier.componentName && !carrier.casNumber && !carrier.ecNumber) {
    return unresolved("carrier_identity_not_disclosed");
  }
  if (!solute.concentration) return unresolved("solute_concentration_missing");
  const concentration = parseExplicitMassPercentageRange(solute.concentration.rawValue);
  if (!concentration) {
    return unresolved("solute_concentration_range_unreadable_or_uncited");
  }

  const soluteIdentifiers = {
    cas: solute.casNumber ? [solute.casNumber.rawValue] : [],
    ec: solute.ecNumber ? [solute.ecNumber.rawValue] : [],
  };
  const candidates = canonicalChemicals.filter((chemical) => compareChemicalIdentifierSets(soluteIdentifiers, {
    cas: chemical.casIdentifiers.map((identifier) => identifier.originalValue),
    ec: chemical.ecIdentifiers.map((identifier) => identifier.originalValue),
  }).status === "compatible");
  if (candidates.length === 0) return unresolved("no_canonical_chemical_matches_solute_identifiers");
  if (candidates.length > 1) return {
    status: "ambiguous",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    rolesReviewedBy: roles.reviewedBy,
    soluteComponentId: solute.id,
    carrierComponentId: carrier.id,
    compositionDisclosure,
    disclosureEvidenceRefs,
    reasonCodes: ["multiple_canonical_solute_matches"],
    evidenceRefs,
    reviewRequired: true,
  };

  return {
    status: "resolved_candidate",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    rolesReviewedBy: roles.reviewedBy,
    soluteComponentId: solute.id,
    carrierComponentId: carrier.id,
    soluteCanonicalChemicalId: candidates[0]!.id,
    compositionDisclosure,
    disclosureEvidenceRefs,
    concentration: {
      originalValue: solute.concentration.rawValue,
      lowerBoundPercent: concentration.lowerBound,
      upperBoundPercent: concentration.upperBound,
      interpretation: concentration.lowerBound === concentration.upperBound ? "exact" : "range",
      basis: "percent_w_w",
    },
    reasonCodes: ["reviewed_solute_carrier_pair_with_source_range"],
    evidenceRefs,
    reviewRequired: true,
  };
}
