import { z } from "zod";
import type { CommercialProductTypeClassification } from "./commercialProductType";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

export const genericFamilyEvidenceSchema = z.object({
  componentId: z.string().trim().min(1),
  sourceFactId: z.string().trim().min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const proprietaryDisclosureComponentSchema = z.object({
  sourceComponentId: z.string().trim().min(1),
  originalName: z.string().min(1).optional(),
  /** Verbatim source text only; this is not a canonical chemistry-family assertion. */
  genericFamilyText: z.string().min(1).optional(),
  casNumber: z.string().min(1).optional(),
  ecNumber: z.string().min(1).optional(),
  concentration: z.string().min(1).optional(),
  disclosure: z.enum(["disclosed", "trade_secret", "withheld", "unknown"]),
  identityStatus: z.enum(["PARTIAL", "AMBIGUOUS", "UNKNOWN"]),
  evidenceRefs: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const proprietaryDisclosureResolutionSchema = z.object({
  status: z.enum(["PARTIAL", "AMBIGUOUS", "UNKNOWN"]),
  commercialProductId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  components: z.array(proprietaryDisclosureComponentSchema),
  remainder: z.object({
    status: z.enum(["explicitly_undisclosed", "not_reported"]),
    originalValue: z.string().min(1).optional(),
    evidenceRefs: z.array(z.string().trim().min(1)).default([]),
  }).strict(),
  reasonCodes: z.array(z.string().trim().min(1)).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).default([]),
  reviewRequired: z.literal(true),
}).strict();

export interface ProprietaryDisclosureResolverInput {
  source: SupplierSdsProductEvidence;
  productType: CommercialProductTypeClassification;
  genericFamilyEvidence?: z.input<typeof genericFamilyEvidenceSchema>[];
}

/** Preserve supplier concealment and generic family wording without making composition or identity claims. */
export function resolveProprietaryDisclosure(input: ProprietaryDisclosureResolverInput): z.infer<typeof proprietaryDisclosureResolutionSchema> {
  const source = supplierSdsProductEvidenceSchema.parse(input.source);
  const genericFamilyEvidence = (input.genericFamilyEvidence ?? []).map((item) => genericFamilyEvidenceSchema.parse(item));
  const componentById = new Map(source.section3.components.map((component) => [component.id, component]));
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
  const refsLinked = input.productType.evidenceRefs.length > 0
    && input.productType.evidenceRefs.every((ref) => sourceRefs.has(ref));
  const familyTextByComponent = new Map<string, string>();
  const validGenericFamilyRefs: string[] = [];
  let hasUnlinkedGenericFamilyEvidence = false;
  for (const familyEvidence of genericFamilyEvidence) {
    const component = componentById.get(familyEvidence.componentId);
    if (!component?.componentName || component.componentName.id !== familyEvidence.sourceFactId
      || !familyEvidence.evidenceRefs.every((ref) => component.componentName!.evidenceRefs.includes(ref))) {
      hasUnlinkedGenericFamilyEvidence = true;
      continue;
    }
    familyTextByComponent.set(component.id, component.componentName.rawValue);
    validGenericFamilyRefs.push(...familyEvidence.evidenceRefs);
  }
  const hasExplicitDisclosure = Boolean(source.section3.undisclosedRemainder)
    || source.section3.components.some((component) => component.disclosure === "trade_secret" || component.disclosure === "withheld")
    || (refsLinked && (input.productType.productType === "PARTIALLY_DISCLOSED" || input.productType.productType === "PROPRIETARY_BLEND"));
  const componentHasIdentifierConflict = (component: typeof source.section3.components[number]) => source.reconciliations.some((item) =>
    item.section3ComponentId === component.id && item.outcome === "conflict",
  );
  const hasIdentifierConflict = source.reconciliations.some((item) => item.outcome === "conflict");
  const status = !refsLinked || hasUnlinkedGenericFamilyEvidence || input.productType.reasonCodes.some((reason) => reason.includes("conflicting")) || hasIdentifierConflict
    ? "AMBIGUOUS" as const
    : hasExplicitDisclosure
      ? "PARTIAL" as const
      : "UNKNOWN" as const;
  const components = source.section3.components.map((component) => {
    const identityStatus = component.disclosure === "trade_secret" || component.disclosure === "withheld"
      ? "PARTIAL" as const
      : componentHasIdentifierConflict(component) ? "AMBIGUOUS" as const : "UNKNOWN" as const;
    const evidenceRefs = [...new Set([
      component.componentName,
      component.casNumber,
      component.ecNumber,
      component.materialNumber,
      component.concentration,
    ].flatMap((fact) => fact?.evidenceRefs ?? []))];
    return {
      sourceComponentId: component.id,
      ...(component.componentName ? { originalName: component.componentName.rawValue } : {}),
      ...(familyTextByComponent.has(component.id) ? { genericFamilyText: familyTextByComponent.get(component.id)! } : {}),
      ...(component.casNumber ? { casNumber: component.casNumber.rawValue } : {}),
      ...(component.ecNumber ? { ecNumber: component.ecNumber.rawValue } : {}),
      ...(component.concentration ? { concentration: component.concentration.rawValue } : {}),
      disclosure: component.disclosure,
      identityStatus,
      evidenceRefs,
    };
  });
  const remainder = source.section3.undisclosedRemainder
    ? { status: "explicitly_undisclosed" as const, originalValue: source.section3.undisclosedRemainder.rawValue, evidenceRefs: source.section3.undisclosedRemainder.evidenceRefs }
    : { status: "not_reported" as const, evidenceRefs: [] };
  const evidenceRefs = [...new Set([...sourceRefs, ...(refsLinked ? input.productType.evidenceRefs : []), ...validGenericFamilyRefs])];
  const reasonCodes = [
    !refsLinked ? "product_type_evidence_unlinked" : undefined,
    hasUnlinkedGenericFamilyEvidence ? "generic_family_evidence_unlinked" : undefined,
    hasIdentifierConflict ? "section_identity_conflict" : undefined,
    hasExplicitDisclosure ? "source_disclosure_preserved" : undefined,
    status === "UNKNOWN" ? "composition_not_established" : undefined,
    familyTextByComponent.size ? "generic_family_retained_as_source_text" : undefined,
    status === "AMBIGUOUS" && !hasIdentifierConflict && refsLinked && !hasUnlinkedGenericFamilyEvidence ? "classification_ambiguous" : undefined,
  ].filter((reason): reason is string => reason !== undefined);
  return {
    status,
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    components,
    remainder,
    reasonCodes,
    evidenceRefs,
    reviewRequired: true,
  };
}
