import { z } from "zod";
import { canonicalChemicalSchema, type CanonicalChemical } from "./canonicalChemical";
import { compareChemicalIdentifierSets, normalizeCasIdentifier, normalizeEcIdentifier } from "./chemicalIdentifiers";
import type { CommercialProductTypeClassification } from "./commercialProductType";
import { parseExplicitMassPercentageRange } from "./singleComponentResolver";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

export const blendComponentResolutionSchema = z.object({
  sourceComponentId: z.string().trim().min(1),
  originalName: z.string().min(1).optional(),
  casNumber: z.string().min(1).optional(),
  ecNumber: z.string().min(1).optional(),
  concentration: z.object({
    originalValue: z.string().min(1),
    massPercentLowerBound: z.number().finite().min(0).max(100).optional(),
    massPercentUpperBound: z.number().finite().min(0).max(100).optional(),
    interpretation: z.enum(["exact", "range", "unparsed"]),
  }).strict().optional(),
  disclosure: z.enum(["disclosed", "trade_secret", "withheld", "unknown"]),
  identityStatus: z.enum(["matched_candidate", "ambiguous", "unmatched", "conflict", "withheld", "unknown"]),
  canonicalChemicalId: z.string().trim().min(1).optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).default([]),
}).strict().superRefine((component, context) => {
  if ((component.identityStatus === "matched_candidate") !== Boolean(component.canonicalChemicalId)) {
    context.addIssue({ code: "custom", path: ["canonicalChemicalId"], message: "Only an exact unique component match may carry a canonical chemical candidate." });
  }
  if (component.concentration) {
    const { interpretation, massPercentLowerBound, massPercentUpperBound } = component.concentration;
    if (interpretation === "unparsed" && (massPercentLowerBound !== undefined || massPercentUpperBound !== undefined)) {
      context.addIssue({ code: "custom", path: ["concentration"], message: "Unparsed concentration evidence cannot contain normalized mass-percent bounds." });
    }
    if (interpretation !== "unparsed" && (massPercentLowerBound === undefined || massPercentUpperBound === undefined)) {
      context.addIssue({ code: "custom", path: ["concentration"], message: "Parsed concentration evidence requires both bounds." });
    }
    if (interpretation === "exact" && massPercentLowerBound !== massPercentUpperBound) {
      context.addIssue({ code: "custom", path: ["concentration"], message: "Exact concentration bounds must be equal." });
    }
    if (interpretation === "range" && massPercentLowerBound !== undefined && massPercentUpperBound !== undefined && massPercentLowerBound >= massPercentUpperBound) {
      context.addIssue({ code: "custom", path: ["concentration"], message: "Range concentration must have distinct ascending bounds." });
    }
    if (massPercentLowerBound !== undefined && massPercentUpperBound !== undefined && massPercentUpperBound < massPercentLowerBound) {
      context.addIssue({ code: "custom", path: ["concentration"], message: "Concentration upper bound cannot be below lower bound." });
    }
    const parsedSource = parseExplicitMassPercentageRange(component.concentration.originalValue);
    if (interpretation === "unparsed" && parsedSource) {
      context.addIssue({ code: "custom", path: ["concentration", "interpretation"], message: "Explicit % w/w source text cannot be labeled unparsed." });
    }
    if (interpretation !== "unparsed" && (!parsedSource
      || parsedSource.lowerBound !== massPercentLowerBound
      || parsedSource.upperBound !== massPercentUpperBound)) {
      context.addIssue({ code: "custom", path: ["concentration"], message: "Concentration bounds must match the exact source text." });
    }
  }
});

export const blendRepresentationSchema = z.object({
  status: z.enum(["represented", "unresolved"]),
  commercialProductId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  components: z.array(blendComponentResolutionSchema),
  remainder: z.object({
    status: z.enum(["explicitly_undisclosed", "not_reported"]),
    originalValue: z.string().min(1).optional(),
    evidenceRefs: z.array(z.string().trim().min(1)).default([]),
  }).strict().superRefine((remainder, context) => {
    if (remainder.status === "explicitly_undisclosed" && (!remainder.originalValue || remainder.evidenceRefs.length === 0)) {
      context.addIssue({ code: "custom", path: ["originalValue"], message: "Explicitly undisclosed remainder requires its source text and evidence references." });
    }
    if (remainder.status === "not_reported" && (remainder.originalValue !== undefined || remainder.evidenceRefs.length > 0)) {
      context.addIssue({ code: "custom", path: ["evidenceRefs"], message: "Not-reported remainder cannot carry undisclosed remainder source data." });
    }
  }),
  reasonCodes: z.array(z.string().trim().min(1)).min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).default([]),
  reviewRequired: z.literal(true),
}).strict().superRefine((record, context) => {
  if (record.status === "represented" && record.components.length < 2) {
    context.addIssue({ code: "custom", path: ["components"], message: "A multicomponent blend representation requires at least two separate source components." });
  }
});

export interface BlendResolverInput {
  source: SupplierSdsProductEvidence;
  productType: CommercialProductTypeClassification;
  canonicalChemicals: CanonicalChemical[];
}

function parseComponentConcentration(rawValue: string) {
  const massPercent = parseExplicitMassPercentageRange(rawValue);
  if (!massPercent) return { originalValue: rawValue, interpretation: "unparsed" as const };
  return {
    originalValue: rawValue,
    massPercentLowerBound: massPercent.lowerBound,
    massPercentUpperBound: massPercent.upperBound,
    interpretation: massPercent.lowerBound === massPercent.upperBound ? "exact" as const : "range" as const,
  };
}

/** Preserve each disclosed blend component and source remainder independently; never collapse the blend into one chemical. */
export function resolveBlend(input: BlendResolverInput): z.infer<typeof blendRepresentationSchema> {
  const source = supplierSdsProductEvidenceSchema.parse(input.source);
  const canonicalChemicals = input.canonicalChemicals.map((chemical) => canonicalChemicalSchema.parse(chemical));
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
  const remainder = source.section3.undisclosedRemainder
    ? { status: "explicitly_undisclosed" as const, originalValue: source.section3.undisclosedRemainder.rawValue, evidenceRefs: source.section3.undisclosedRemainder.evidenceRefs }
    : { status: "not_reported" as const, evidenceRefs: [] };

  const unresolved = (reasonCode: string): z.infer<typeof blendRepresentationSchema> => ({
    status: "unresolved",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    components: [],
    remainder,
    reasonCodes: [reasonCode],
    evidenceRefs,
    reviewRequired: true,
  });
  if (input.productType.productType !== "MULTICOMPONENT_BLEND") return unresolved("product_not_classified_as_multicomponent_blend");
  if (!input.productType.evidenceRefs.length || input.productType.evidenceRefs.some((ref) => !sourceRefs.has(ref))) {
    return unresolved("product_type_evidence_not_linked_to_source_record");
  }
  if (source.section3.components.length < 2) return unresolved("fewer_than_two_disclosed_components");

  const components = source.section3.components.map((component): z.infer<typeof blendComponentResolutionSchema> => {
    const componentEvidenceRefs = [...new Set([
      component.componentName,
      component.casNumber,
      component.ecNumber,
      component.materialNumber,
      component.concentration,
    ].flatMap((fact) => fact?.evidenceRefs ?? []))];
    const identifierSet = {
      cas: component.casNumber ? [component.casNumber.rawValue] : [],
      ec: component.ecNumber ? [component.ecNumber.rawValue] : [],
    };
    let identityStatus: z.infer<typeof blendComponentResolutionSchema>["identityStatus"] = "unknown";
    let canonicalChemicalId: string | undefined;
    if (component.disclosure === "trade_secret" || component.disclosure === "withheld") {
      identityStatus = "withheld";
    } else if (identifierSet.cas.length || identifierSet.ec.length) {
      const candidates = canonicalChemicals.filter((chemical) => compareChemicalIdentifierSets(identifierSet, {
        cas: chemical.casIdentifiers.map((identifier) => identifier.originalValue),
        ec: chemical.ecIdentifiers.map((identifier) => identifier.originalValue),
      }).status === "compatible");
      if (candidates.length === 1) {
        identityStatus = "matched_candidate";
        canonicalChemicalId = candidates[0]!.id;
      } else if (candidates.length > 1) identityStatus = "ambiguous";
      else if (identifierSet.cas.some((value) => !normalizeCasIdentifier(value).ok)
        || identifierSet.ec.some((value) => !normalizeEcIdentifier(value).ok)) identityStatus = "conflict";
      else identityStatus = "unmatched";
    } else if (component.componentName) identityStatus = "unmatched";

    return {
      sourceComponentId: component.id,
      ...(component.componentName ? { originalName: component.componentName.rawValue } : {}),
      ...(component.casNumber ? { casNumber: component.casNumber.rawValue } : {}),
      ...(component.ecNumber ? { ecNumber: component.ecNumber.rawValue } : {}),
      ...(component.concentration ? { concentration: parseComponentConcentration(component.concentration.rawValue) } : {}),
      disclosure: component.disclosure,
      identityStatus,
      ...(canonicalChemicalId ? { canonicalChemicalId } : {}),
      evidenceRefs: componentEvidenceRefs,
    };
  });
  return {
    status: "represented",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    components,
    remainder,
    reasonCodes: ["source_components_preserved_individually"],
    evidenceRefs,
    reviewRequired: true,
  };
}
