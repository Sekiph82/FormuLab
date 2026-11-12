import { z } from "zod";

export const COMMERCIAL_PRODUCT_TYPES = [
  "PURE_OR_NEAR_PURE",
  "SOLUTION",
  "POLYMER",
  "MULTICOMPONENT_BLEND",
  "PROPRIETARY_BLEND",
  "PARTIALLY_DISCLOSED",
  "UNKNOWN",
] as const;

export const commercialProductTypeObservationSchema = z.object({
  kind: z.enum(["explicit_type", "substance_or_mixture", "component_count", "composition_complete", "trade_secret", "undisclosed_remainder"]),
  value: z.union([z.string(), z.number().int().nonnegative(), z.boolean()]),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((observation, context) => {
  const requiresString = observation.kind === "explicit_type" || observation.kind === "substance_or_mixture";
  const requiresNumber = observation.kind === "component_count";
  const requiresBoolean = observation.kind === "composition_complete" || observation.kind === "trade_secret" || observation.kind === "undisclosed_remainder";
  if (requiresString && typeof observation.value !== "string") {
    context.addIssue({ code: "custom", path: ["value"], message: `${observation.kind} observations require a string value.` });
  }
  if (requiresNumber && typeof observation.value !== "number") {
    context.addIssue({ code: "custom", path: ["value"], message: "component_count observations require a number value." });
  }
  if (requiresBoolean && typeof observation.value !== "boolean") {
    context.addIssue({ code: "custom", path: ["value"], message: `${observation.kind} observations require a boolean value.` });
  }
});

export const commercialProductTypeInputSchema = z.object({
  observations: z.array(commercialProductTypeObservationSchema).default([]),
}).strict();

export interface CommercialProductTypeClassification {
  productType: typeof COMMERCIAL_PRODUCT_TYPES[number];
  reasonCodes: string[];
  evidenceRefs: string[];
  reviewRequired: boolean;
}

type EvidenceBackedProductType = Exclude<typeof COMMERCIAL_PRODUCT_TYPES[number], "UNKNOWN">;
const EXPLICIT_TYPES: ReadonlySet<string> = new Set<EvidenceBackedProductType>([
  "PURE_OR_NEAR_PURE",
  "SOLUTION",
  "POLYMER",
  "MULTICOMPONENT_BLEND",
  "PROPRIETARY_BLEND",
  "PARTIALLY_DISCLOSED",
]);

/**
 * Conservative evidence-based classifier. It consumes structured, cited
 * observations and never infers a class from trade names or chemical names.
 */
export function classifyCommercialProductType(input: z.input<typeof commercialProductTypeInputSchema>): CommercialProductTypeClassification {
  const parsed = commercialProductTypeInputSchema.parse(input);
  const observations = parsed.observations;
  const relevant = (kind: typeof observations[number]["kind"]) => observations.filter((item) => item.kind === kind);
  const evidenceRefs = [...new Set(observations.flatMap((item) => item.evidenceRefs))];
  const contradictoryBooleanEvidence = (["composition_complete", "trade_secret", "undisclosed_remainder"] as const)
    .some((kind) => new Set(relevant(kind).map((item) => item.value)).size > 1);
  if (contradictoryBooleanEvidence) {
    return { productType: "UNKNOWN", reasonCodes: ["conflicting_boolean_evidence"], evidenceRefs, reviewRequired: true };
  }
  const tradeSecret = relevant("trade_secret").some((item) => item.value === true);
  const undisclosedRemainder = relevant("undisclosed_remainder").some((item) => item.value === true);
  if (undisclosedRemainder) return { productType: "PARTIALLY_DISCLOSED", reasonCodes: ["undisclosed_remainder_evidence"], evidenceRefs, reviewRequired: true };
  if (tradeSecret) return { productType: "PROPRIETARY_BLEND", reasonCodes: ["trade_secret_disclosure_evidence"], evidenceRefs, reviewRequired: true };

  const componentCounts = relevant("component_count").map((item) => item.value).filter((value): value is number => typeof value === "number");
  const declarations = relevant("substance_or_mixture").map((item) => typeof item.value === "string" ? item.value.trim().toLocaleLowerCase("en-US") : "");
  if (new Set(componentCounts).size > 1 || new Set(declarations.filter(Boolean)).size > 1) {
    return { productType: "UNKNOWN", reasonCodes: ["conflicting_composition_evidence"], evidenceRefs, reviewRequired: true };
  }
  const componentCount = componentCounts[0];
  const declaration = declarations.find(Boolean);

  const explicitTypes = [...new Set(relevant("explicit_type")
    .map((item) => typeof item.value === "string" ? item.value.trim().toUpperCase() : "")
    .filter((value): value is EvidenceBackedProductType => EXPLICIT_TYPES.has(value)))];
  const hasInvalidExplicitType = relevant("explicit_type").some((item) =>
    typeof item.value !== "string" || !EXPLICIT_TYPES.has(item.value.trim().toUpperCase()),
  );
  const conflicts = explicitTypes.length > 1 || hasInvalidExplicitType;

  if (conflicts) return { productType: "UNKNOWN", reasonCodes: ["conflicting_or_unrecognized_type_evidence"], evidenceRefs, reviewRequired: true };
  if (explicitTypes.length === 1) {
    const explicitType = explicitTypes[0]!;
    if ((explicitType === "PURE_OR_NEAR_PURE" && componentCount !== undefined && componentCount > 1)
      || (explicitType === "MULTICOMPONENT_BLEND" && componentCount !== undefined && componentCount < 2)
      || (explicitType === "PURE_OR_NEAR_PURE" && declaration === "mixture")
      || (explicitType === "SOLUTION" && declaration === "substance")
      || (explicitType === "MULTICOMPONENT_BLEND" && declaration === "substance")) {
      return { productType: "UNKNOWN", reasonCodes: ["explicit_type_conflicts_with_composition_evidence"], evidenceRefs, reviewRequired: true };
    }
    return { productType: explicitType, reasonCodes: ["explicit_type_evidence"], evidenceRefs, reviewRequired: true };
  }
  if (componentCount !== undefined && componentCount > 1) {
    if (declaration === "substance") {
      return { productType: "UNKNOWN", reasonCodes: ["conflicting_composition_evidence"], evidenceRefs, reviewRequired: true };
    }
    return { productType: "MULTICOMPONENT_BLEND", reasonCodes: ["multiple_disclosed_components"], evidenceRefs, reviewRequired: true };
  }
  const compositionComplete = relevant("composition_complete").some((item) => item.value === true);
  if (declaration === "substance" && componentCount === 1 && compositionComplete) {
    return { productType: "PURE_OR_NEAR_PURE", reasonCodes: ["single_component_substance_declaration"], evidenceRefs, reviewRequired: true };
  }
  return { productType: "UNKNOWN", reasonCodes: ["insufficient_product_type_evidence"], evidenceRefs, reviewRequired: true };
}
