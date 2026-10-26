import { z } from "zod";
import { parseExplicitMassPercentageRange } from "./singleComponentResolver";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

/** A source-backed mass fraction of one SDS component in its commercial product. */
export const compositionFractionEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  quantityKind: z.literal("component_fraction"),
  basis: z.literal("mass_fraction_of_commercial_product"),
  commercialProductId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceComponentId: z.string().trim().min(1),
  sourceFactId: z.string().trim().min(1),
  originalValue: z.string().min(1),
  fraction: z.object({
    lowerBound: z.number().finite().min(0).max(1).optional(),
    upperBound: z.number().finite().min(0).max(1).optional(),
    interpretation: z.enum(["exact", "range", "unparsed"]),
  }).strict(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((record, context) => {
  const { lowerBound, upperBound, interpretation } = record.fraction;
  if (interpretation === "unparsed") {
    if (lowerBound !== undefined || upperBound !== undefined) {
      context.addIssue({ code: "custom", path: ["fraction"], message: "Unparsed component fractions cannot contain normalized bounds." });
    }
    if (parseExplicitMassPercentageRange(record.originalValue)) {
      context.addIssue({ code: "custom", path: ["fraction", "interpretation"], message: "Explicit % w/w source text cannot be labeled unparsed." });
    }
    return;
  }
  if (lowerBound === undefined || upperBound === undefined) {
    context.addIssue({ code: "custom", path: ["fraction"], message: "Parsed component fractions require both normalized bounds." });
    return;
  }
  if (interpretation === "exact" && lowerBound !== upperBound) {
    context.addIssue({ code: "custom", path: ["fraction"], message: "Exact component fraction bounds must be equal." });
  }
  if (interpretation === "range" && lowerBound >= upperBound) {
    context.addIssue({ code: "custom", path: ["fraction"], message: "Range component fraction bounds must be ascending and distinct." });
  }
  const parsedSource = parseExplicitMassPercentageRange(record.originalValue);
  if (!parsedSource || parsedSource.lowerBound / 100 !== lowerBound || parsedSource.upperBound / 100 !== upperBound) {
    context.addIssue({ code: "custom", path: ["fraction"], message: "Normalized component fraction must match the cited source % w/w value." });
  }
  if (lowerBound === undefined || upperBound === undefined || upperBound < lowerBound) {
    context.addIssue({ code: "custom", path: ["fraction"], message: "Component fraction upper bound cannot be below its lower bound." });
  }
});

export type CompositionFractionEvidence = z.infer<typeof compositionFractionEvidenceSchema>;

/** Validate persisted lineage against the immutable SDS source before accepting a stored fraction record. */
export function validateCompositionFractionEvidenceAgainstSource(
  recordInput: CompositionFractionEvidence,
  sourceInput: SupplierSdsProductEvidence,
): CompositionFractionEvidence {
  const record = compositionFractionEvidenceSchema.parse(recordInput);
  const source = supplierSdsProductEvidenceSchema.parse(sourceInput);
  const component = source.section3.components.find((item) => item.id === record.sourceComponentId);
  const fact = component?.concentration;
  if (!component || !fact
    || record.commercialProductId !== source.commercialProductId
    || record.sourceEvidenceId !== source.id
    || record.sourceDocumentHash !== source.section3.sourceDocumentHash
    || record.sourceFactId !== fact.id
    || record.originalValue !== fact.rawValue
    || record.evidenceRefs.length !== fact.evidenceRefs.length
    || record.evidenceRefs.some((ref, index) => ref !== fact.evidenceRefs[index])) {
    throw new Error("Composition fraction lineage does not match its immutable SDS source fact.");
  }
  return record;
}

/** Build a separate component-fraction record from one cited SDS Section 3 fact; missing concentration stays absent. */
export function createCompositionFractionEvidence(
  sourceInput: SupplierSdsProductEvidence,
  sourceComponentId: string,
): CompositionFractionEvidence | undefined {
  const source = supplierSdsProductEvidenceSchema.parse(sourceInput);
  const component = source.section3.components.find((item) => item.id === sourceComponentId);
  if (!component?.concentration) return undefined;
  const rawValue = component.concentration.rawValue;
  const parsed = parseExplicitMassPercentageRange(rawValue);
  const fraction: CompositionFractionEvidence["fraction"] = parsed
    ? {
      lowerBound: parsed.lowerBound / 100,
      upperBound: parsed.upperBound / 100,
      interpretation: parsed.lowerBound === parsed.upperBound ? "exact" : "range",
    }
    : { interpretation: "unparsed" };
  const record = compositionFractionEvidenceSchema.parse({
    schemaVersion: "1.0",
    id: `composition-fraction:${source.id}:${component.id}:${component.concentration.id}`,
    quantityKind: "component_fraction",
    basis: "mass_fraction_of_commercial_product",
    commercialProductId: source.commercialProductId,
    sourceEvidenceId: source.id,
    sourceDocumentHash: source.section3.sourceDocumentHash,
    sourceComponentId: component.id,
    sourceFactId: component.concentration.id,
    originalValue: rawValue,
    fraction,
    evidenceRefs: component.concentration.evidenceRefs,
  });
  return validateCompositionFractionEvidenceAgainstSource(record, source);
}
