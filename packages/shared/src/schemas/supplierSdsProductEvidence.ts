import { z } from "zod";
import { normalizeCasIdentifier, normalizeEcIdentifier } from "./chemicalIdentifiers";

export const supplierSdsCitedFactSchema = z.object({
  id: z.string().trim().min(1),
  /** Preserve exact extracted text; whitespace is checked for blankness only. */
  rawValue: z.string().min(1).refine((value) => value.trim().length > 0, "Evidence value cannot be blank."),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();

/** Section 1 describes the commercial product as supplied; its fields remain product-level facts. */
export const supplierSdsSection1ProductEvidenceSchema = z.object({
  sectionNumber: z.literal(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  declaredChemicalName: supplierSdsCitedFactSchema.optional(),
  chemicalNature: supplierSdsCitedFactSchema.optional(),
  casNumber: supplierSdsCitedFactSchema.optional(),
  ecNumber: supplierSdsCitedFactSchema.optional(),
  materialNumber: supplierSdsCitedFactSchema.optional(),
  productDescription: supplierSdsCitedFactSchema.optional(),
}).strict();

/** Section 3 describes disclosed components; no field is copied into product-level identity. */
export const supplierSdsSection3CompositionEvidenceSchema = z.object({
  sectionNumber: z.literal(3),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  substanceOrMixture: supplierSdsCitedFactSchema.optional(),
  components: z.array(z.object({
    id: z.string().trim().min(1),
    componentName: supplierSdsCitedFactSchema.optional(),
    casNumber: supplierSdsCitedFactSchema.optional(),
    ecNumber: supplierSdsCitedFactSchema.optional(),
    materialNumber: supplierSdsCitedFactSchema.optional(),
    concentration: supplierSdsCitedFactSchema.optional(),
    disclosure: z.enum(["disclosed", "trade_secret", "withheld", "unknown"]).default("unknown"),
  }).strict()).default([]),
  undisclosedRemainder: supplierSdsCitedFactSchema.optional(),
}).strict();

export const supplierSdsSectionReconciliationSchema = z.object({
  section1FactId: z.string().trim().min(1),
  section3ComponentId: z.string().trim().min(1),
  outcome: z.enum(["consistent", "conflict", "unresolved"]),
  basis: z.enum(["exact_cas", "exact_ec", "human_review", "insufficient_evidence"]),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  rationaleCode: z.string().trim().min(1),
  reviewedBy: z.string().trim().min(1).optional(),
}).strict();

/** Separate source facts and explicit cross-section reconciliation; this is not a resolved chemical identity. */
export const supplierSdsProductEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  section1: supplierSdsSection1ProductEvidenceSchema,
  section3: supplierSdsSection3CompositionEvidenceSchema,
  reconciliations: z.array(supplierSdsSectionReconciliationSchema).default([]),
}).strict().superRefine((record, context) => {
  const section1FactIds = [
    record.section1.declaredChemicalName?.id,
    record.section1.chemicalNature?.id,
    record.section1.casNumber?.id,
    record.section1.ecNumber?.id,
    record.section1.materialNumber?.id,
    record.section1.productDescription?.id,
  ].filter((id): id is string => id !== undefined);
  const section1Facts = new Set(section1FactIds);
  const componentIds = new Set(record.section3.components.map((component) => component.id));
  const allIds = [
    ...section1FactIds,
    record.section3.substanceOrMixture?.id,
    record.section3.undisclosedRemainder?.id,
    ...record.section3.components.flatMap((component) => [
      component.id,
      component.componentName?.id,
      component.casNumber?.id,
      component.ecNumber?.id,
      component.materialNumber?.id,
      component.concentration?.id,
    ]),
  ].filter((id): id is string => id !== undefined);
  if (new Set(allIds).size !== allIds.length) {
    context.addIssue({ code: "custom", path: ["section3", "components"], message: "Fact and component IDs must be unique within the evidence record." });
  }
  if (record.section1.sourceDocumentHash.toLowerCase() !== record.section3.sourceDocumentHash.toLowerCase()) {
    context.addIssue({ code: "custom", path: ["section3", "sourceDocumentHash"], message: "Section 1 and Section 3 evidence must come from the same SDS document." });
  }
  for (const [index, reconciliation] of record.reconciliations.entries()) {
    if (!section1Facts.has(reconciliation.section1FactId)) {
      context.addIssue({ code: "custom", path: ["reconciliations", index, "section1FactId"], message: "Reconciliation must reference an existing Section 1 product fact." });
    }
    if (!componentIds.has(reconciliation.section3ComponentId)) {
      context.addIssue({ code: "custom", path: ["reconciliations", index, "section3ComponentId"], message: "Reconciliation must reference an existing Section 3 component." });
    }
    if (reconciliation.basis === "human_review" && !reconciliation.reviewedBy) {
      context.addIssue({ code: "custom", path: ["reconciliations", index, "reviewedBy"], message: "Human reconciliation requires a named reviewer." });
    }
    if (reconciliation.basis === "insufficient_evidence" && reconciliation.outcome !== "unresolved") {
      context.addIssue({ code: "custom", path: ["reconciliations", index, "outcome"], message: "Insufficient evidence must remain unresolved." });
    }
    const section1Fact = [record.section1.casNumber, record.section1.ecNumber].find((fact) => fact?.id === reconciliation.section1FactId);
    const component = record.section3.components.find((candidate) => candidate.id === reconciliation.section3ComponentId);
    const componentFact = reconciliation.basis === "exact_cas" ? component?.casNumber : component?.ecNumber;
    if (reconciliation.basis === "exact_cas" || reconciliation.basis === "exact_ec") {
      const expectedSection1Fact = reconciliation.basis === "exact_cas" ? record.section1.casNumber : record.section1.ecNumber;
      if (section1Fact?.id !== expectedSection1Fact?.id || !expectedSection1Fact || !componentFact) {
        context.addIssue({ code: "custom", path: ["reconciliations", index], message: "Exact identifier reconciliation must reference the matching Section 1 and Section 3 identifier facts." });
      } else {
        const normalize = reconciliation.basis === "exact_cas" ? normalizeCasIdentifier : normalizeEcIdentifier;
        const left = normalize(expectedSection1Fact.rawValue);
        const right = normalize(componentFact.rawValue);
        const equal = left.ok && right.ok && left.normalizedValue === right.normalizedValue;
        if (!left.ok || !right.ok || (reconciliation.outcome === "consistent") !== equal || reconciliation.outcome === "unresolved") {
          context.addIssue({ code: "custom", path: ["reconciliations", index, "outcome"], message: "Exact identifier reconciliation outcome must match the validated source identifiers." });
        }
        for (const requiredRef of [...expectedSection1Fact.evidenceRefs, ...componentFact.evidenceRefs]) {
          if (!reconciliation.evidenceRefs.includes(requiredRef)) {
            context.addIssue({ code: "custom", path: ["reconciliations", index, "evidenceRefs"], message: "Exact identifier reconciliation must cite both linked identifier facts." });
            break;
          }
        }
      }
    }
    if (reconciliation.basis === "human_review" || reconciliation.basis === "insufficient_evidence") {
      const linkedSection1Fact = [
        record.section1.casNumber,
        record.section1.ecNumber,
        record.section1.materialNumber,
        record.section1.declaredChemicalName,
        record.section1.chemicalNature,
        record.section1.productDescription,
      ].find((fact) => fact?.id === reconciliation.section1FactId);
      const componentFacts = [component?.componentName, component?.casNumber, component?.ecNumber,
        component?.materialNumber,
        ...(reconciliation.basis === "human_review" ? [component?.concentration] : [])]
        .filter((fact): fact is SupplierSdsCitedFact => fact !== undefined);
      const requiredRefs = [
        ...(linkedSection1Fact?.evidenceRefs ?? []),
        ...componentFacts.flatMap((fact) => fact.evidenceRefs),
      ];
      if (requiredRefs.some((requiredRef) => !reconciliation.evidenceRefs.includes(requiredRef))) {
        context.addIssue({ code: "custom", path: ["reconciliations", index, "evidenceRefs"], message: "Manual or unresolved reconciliation must cite its linked source facts." });
      }
    }
  }
});

type Section1ProductEvidence = z.infer<typeof supplierSdsSection1ProductEvidenceSchema>;
type Section3ComponentEvidence = z.infer<typeof supplierSdsSection3CompositionEvidenceSchema>["components"][number];

/** Compare one Section 1 product identity with one Section 3 component only through matching validated identifiers. */
export function reconcileSection1WithSection3Component(
  section1: Section1ProductEvidence,
  component: Section3ComponentEvidence,
): z.infer<typeof supplierSdsSectionReconciliationSchema> {
  const section1FactId = section1.casNumber?.id ?? section1.ecNumber?.id ?? section1.materialNumber?.id ?? section1.declaredChemicalName?.id
    ?? section1.chemicalNature?.id ?? section1.productDescription?.id;
  if (!section1FactId) throw new Error("Section 1 identity evidence is required for explicit reconciliation.");
  const compared: Array<{ kind: "exact_cas" | "exact_ec"; left?: SupplierSdsCitedFact; right?: SupplierSdsCitedFact; equal: boolean; valid: boolean }> = [];
  for (const [kind, left, right, normalize] of [
    ["exact_cas", section1.casNumber, component.casNumber, normalizeCasIdentifier],
    ["exact_ec", section1.ecNumber, component.ecNumber, normalizeEcIdentifier],
  ] as const) {
    if (!left || !right) continue;
    const normalizedLeft = normalize(left.rawValue);
    const normalizedRight = normalize(right.rawValue);
    compared.push({
      kind,
      left,
      right,
      equal: normalizedLeft.ok && normalizedRight.ok && normalizedLeft.normalizedValue === normalizedRight.normalizedValue,
      valid: normalizedLeft.ok && normalizedRight.ok,
    });
  }
  const linkedSection1Fact = [section1.casNumber, section1.ecNumber, section1.materialNumber, section1.declaredChemicalName,
    section1.chemicalNature, section1.productDescription].find((fact) => fact?.id === section1FactId);
  const evidenceRefs = [...new Set([
    linkedSection1Fact,
    section1.casNumber,
    section1.ecNumber,
    section1.materialNumber,
    component.componentName,
    component.casNumber,
    component.ecNumber,
    component.materialNumber,
  ].flatMap((fact) => fact?.evidenceRefs ?? []))];
  const conflicting = compared.some((item) => item.valid && !item.equal);
  const invalid = compared.some((item) => !item.valid);
  const matching = compared.find((item) => item.valid && item.equal);
  if (conflicting) {
    const conflict = compared.find((item) => item.valid && !item.equal)!;
    return { section1FactId: conflict.left?.id ?? section1FactId, section3ComponentId: component.id, outcome: "conflict", basis: conflict.kind, evidenceRefs, rationaleCode: "validated_section_identifiers_conflict" };
  }
  if (invalid || !matching) {
    return { section1FactId, section3ComponentId: component.id, outcome: "unresolved", basis: "insufficient_evidence", evidenceRefs, rationaleCode: invalid ? "section_identifier_failed_validation" : "no_shared_valid_identifier_name_not_compared" };
  }
  return { section1FactId: matching.left!.id, section3ComponentId: component.id, outcome: "consistent", basis: matching.kind, evidenceRefs, rationaleCode: "shared_validated_identifier" };
}

export type SupplierSdsCitedFact = z.infer<typeof supplierSdsCitedFactSchema>;
export type SupplierSdsProductEvidence = z.infer<typeof supplierSdsProductEvidenceSchema>;

/** Persisted, immutable extraction snapshot linked to the exact acquired SDS bytes. */
export const supplierSdsProductEvidenceRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().trim().min(1),
  acquisitionCode: z.string().trim().min(1),
  evidence: supplierSdsProductEvidenceSchema,
  extractionStatus: z.literal("unreviewed"),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((record, context) => {
  if (record.code !== record.evidence.id) {
    context.addIssue({ code: "custom", path: ["code"], message: "Persisted SDS evidence code must match its immutable evidence identity." });
  }
});

export type SupplierSdsProductEvidenceRecord = z.infer<typeof supplierSdsProductEvidenceRecordSchema>;
