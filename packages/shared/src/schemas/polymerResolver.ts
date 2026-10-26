import { z } from "zod";
import { canonicalPolymerSchema, normalizePolymerMaterialNumber, type CanonicalPolymer } from "./canonicalPolymer";
import { normalizeCasIdentifier, normalizeEcIdentifier } from "./chemicalIdentifiers";
import type { CommercialProductTypeClassification } from "./commercialProductType";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

export const polymerResolutionSchema = z.object({
  status: z.enum(["resolved_candidate", "unresolved", "ambiguous"]),
  commercialProductId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  componentId: z.string().trim().min(1).optional(),
  canonicalPolymerId: z.string().trim().min(1).optional(),
  polymerType: z.enum(["homopolymer", "copolymer", "crosspolymer", "macromolecular_material", "unknown"]).optional(),
  reasonCodes: z.array(z.string().trim().min(1)).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).default([]),
  reviewRequired: z.literal(true),
}).strict().superRefine((result, context) => {
  if ((result.status === "resolved_candidate") !== Boolean(result.canonicalPolymerId)) {
    context.addIssue({ code: "custom", path: ["canonicalPolymerId"], message: "Only resolved candidates may contain a canonical polymer ID." });
  }
});

export interface PolymerResolverInput {
  source: SupplierSdsProductEvidence;
  productType: CommercialProductTypeClassification;
  canonicalPolymers: CanonicalPolymer[];
}

/** Resolve only explicit polymer evidence against polymer records; never coerce polymers into small-molecule identities. */
export function resolvePolymer(input: PolymerResolverInput): z.infer<typeof polymerResolutionSchema> {
  const source = supplierSdsProductEvidenceSchema.parse(input.source);
  const canonicalPolymers = input.canonicalPolymers.map((polymer) => canonicalPolymerSchema.parse(polymer));
  const sourceRefs = new Set([
    source.section1.declaredChemicalName,
    source.section1.chemicalNature,
    source.section1.casNumber,
    source.section1.ecNumber,
    source.section1.materialNumber,
    source.section1.productDescription,
    source.section3.substanceOrMixture,
    source.section3.undisclosedRemainder,
    ...source.section3.components.flatMap((component) => [component.componentName, component.casNumber, component.ecNumber, component.materialNumber, component.concentration]),
  ].flatMap((fact) => fact?.evidenceRefs ?? []));
  const evidenceRefs = [...new Set([...sourceRefs, ...input.productType.evidenceRefs])];
  const unresolved = (reasonCode: string): z.infer<typeof polymerResolutionSchema> => ({
    status: "unresolved",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    reasonCodes: [reasonCode],
    evidenceRefs,
    reviewRequired: true,
  });

  if (input.productType.productType !== "POLYMER") return unresolved("product_not_classified_as_polymer");
  if (!input.productType.evidenceRefs.length || input.productType.evidenceRefs.some((ref) => !sourceRefs.has(ref))) {
    return unresolved("polymer_type_evidence_not_linked_to_source_record");
  }
  if (source.section3.components.length !== 1) return unresolved("not_exactly_one_polymer_component");
  const component = source.section3.components[0]!;
  if (source.section3.undisclosedRemainder || component.disclosure === "trade_secret" || component.disclosure === "withheld") {
    return { ...unresolved("polymer_composition_is_partially_disclosed"), componentId: component.id };
  }

  const sharedIdentifiers: Array<{ kind: "cas" | "ec" | "material_number"; value: string }> = [];
  let conflictingIdentifier = false;
  const compareIdentifier = (kind: "cas" | "ec", left: string | undefined, right: string | undefined) => {
    if (!left || !right) return;
    const normalize = kind === "cas" ? normalizeCasIdentifier : normalizeEcIdentifier;
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    if (!normalizedLeft.ok || !normalizedRight.ok || normalizedLeft.normalizedValue !== normalizedRight.normalizedValue) {
      conflictingIdentifier = true;
    } else {
      sharedIdentifiers.push({ kind, value: normalizedLeft.normalizedValue });
    }
  };
  compareIdentifier("cas", source.section1.casNumber?.rawValue, component.casNumber?.rawValue);
  compareIdentifier("ec", source.section1.ecNumber?.rawValue, component.ecNumber?.rawValue);
  if (source.section1.materialNumber && component.materialNumber) {
    const productMaterialNumber = normalizePolymerMaterialNumber(source.section1.materialNumber.rawValue);
    const componentMaterialNumber = normalizePolymerMaterialNumber(component.materialNumber.rawValue);
    if (productMaterialNumber !== componentMaterialNumber) conflictingIdentifier = true;
    else sharedIdentifiers.push({ kind: "material_number", value: productMaterialNumber });
  }
  if (conflictingIdentifier) return { ...unresolved("section1_section3_polymer_identifiers_conflict"), componentId: component.id };
  if (sharedIdentifiers.length === 0) return { ...unresolved("no_shared_valid_polymer_identifier"), componentId: component.id };

  const candidates = canonicalPolymers.filter((polymer) => {
    let hasExactMatch = false;
    for (const { kind, value } of sharedIdentifiers) {
      const values = kind === "cas"
        ? polymer.casIdentifiers.map((identifier) => identifier.normalizedValue)
        : kind === "ec"
          ? polymer.ecIdentifiers.map((identifier) => identifier.normalizedValue)
          : polymer.materialNumbers.map((identifier) => identifier.normalizedValue);
      if (values.length === 0) continue;
      if (!values.includes(value)) return false;
      hasExactMatch = true;
    }
    return hasExactMatch;
  });
  if (candidates.length === 0) return { ...unresolved("no_canonical_polymer_matches_shared_identity"), componentId: component.id };
  if (candidates.length > 1) return {
    status: "ambiguous",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    componentId: component.id,
    reasonCodes: ["multiple_canonical_polymer_matches"],
    evidenceRefs,
    reviewRequired: true,
  };
  return {
    status: "resolved_candidate",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    componentId: component.id,
    canonicalPolymerId: candidates[0]!.id,
    polymerType: candidates[0]!.polymerType,
    reasonCodes: ["exact_cross_section_polymer_identifier_match"],
    evidenceRefs,
    reviewRequired: true,
  };
}
