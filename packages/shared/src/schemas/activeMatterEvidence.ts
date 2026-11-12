import { z } from "zod";

export const EXPLICIT_PRODUCT_CLAIM_KINDS = ["active_matter", "solids_content", "assay"] as const;
const PRODUCT_CLAIM_LABEL_PATTERNS: Record<typeof EXPLICIT_PRODUCT_CLAIM_KINDS[number], RegExp> = {
  active_matter: /\bactive\s+(?:matter|content|substance)\b/iu,
  solids_content: /\b(?:total\s+)?solids?\s+(?:content|matter|percentage|%)\b/iu,
  assay: /\bassay\b/iu,
};

function explicitlySupportsQuantity(label: string, kind: typeof EXPLICIT_PRODUCT_CLAIM_KINDS[number]): boolean {
  return PRODUCT_CLAIM_LABEL_PATTERNS[kind].test(label)
    && !/\b(?:non[-\s]?active|absence\s+of|no|not|without|free\s+of)\b/iu.test(label);
}

export const authorizedProductClaimInputSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  sourceDocumentType: z.enum(["SDS", "TDS", "CERTIFICATE_OF_ANALYSIS", "OTHER_AUTHORIZED"]),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceEvidenceId: z.string().trim().min(1),
  sourceSectionNumber: z.number().int().positive().optional(),
  sourceFactId: z.string().trim().min(1),
  quantityKind: z.enum(EXPLICIT_PRODUCT_CLAIM_KINDS),
  explicitPropertyLabel: z.string().trim().min(1),
  originalValue: z.string().trim().min(1),
  basis: z.enum(["as_supplied", "dry_basis", "active_basis", "other_explicit", "unspecified"]),
  authorizationReference: z.string().trim().min(1).optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((claim, context) => {
  if (claim.sourceDocumentType === "SDS" && claim.sourceSectionNumber === 3) {
    context.addIssue({ code: "custom", path: ["sourceSectionNumber"], message: "SDS Section 3 hazard-disclosure composition cannot support active matter, solids or assay." });
  }
  if (claim.sourceDocumentType === "SDS" && claim.sourceSectionNumber === undefined) {
    context.addIssue({ code: "custom", path: ["sourceSectionNumber"], message: "SDS product claims require a cited section number." });
  }
  if (claim.sourceDocumentType === "OTHER_AUTHORIZED" && !claim.authorizationReference) {
    context.addIssue({ code: "custom", path: ["authorizationReference"], message: "Other evidence requires an authorization reference." });
  }
  if (!explicitlySupportsQuantity(claim.explicitPropertyLabel, claim.quantityKind)) {
    context.addIssue({ code: "custom", path: ["explicitPropertyLabel"], message: `The source label must explicitly identify ${claim.quantityKind}.` });
  }
});

export const activeMatterEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  quantityKind: z.enum(EXPLICIT_PRODUCT_CLAIM_KINDS),
  sourceDocumentType: z.enum(["SDS", "TDS", "CERTIFICATE_OF_ANALYSIS", "OTHER_AUTHORIZED"]),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceEvidenceId: z.string().trim().min(1),
  sourceSectionNumber: z.number().int().positive().optional(),
  sourceFactId: z.string().trim().min(1),
  explicitPropertyLabel: z.string().trim().min(1),
  originalValue: z.string().trim().min(1),
  basis: z.enum(["as_supplied", "dry_basis", "active_basis", "other_explicit", "unspecified"]),
  percent: z.object({
    lowerBound: z.number().finite().min(0).max(100).optional(),
    upperBound: z.number().finite().min(0).max(100).optional(),
    interpretation: z.enum(["exact", "range", "unparsed"]),
  }).strict(),
  authorizationReference: z.string().trim().min(1).optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  provenanceStatus: z.literal("provisional"),
  reviewRequired: z.literal(true),
}).strict().superRefine((record, context) => {
  if (!explicitlySupportsQuantity(record.explicitPropertyLabel, record.quantityKind)) {
    context.addIssue({ code: "custom", path: ["explicitPropertyLabel"], message: `The source label must explicitly identify ${record.quantityKind}.` });
  }
  if (record.sourceDocumentType === "SDS" && (record.sourceSectionNumber === undefined || record.sourceSectionNumber === 3)) {
    context.addIssue({ code: "custom", path: ["sourceSectionNumber"], message: "SDS product claims require a cited non-Section-3 source section." });
  }
  if (record.sourceDocumentType === "OTHER_AUTHORIZED" && !record.authorizationReference) {
    context.addIssue({ code: "custom", path: ["authorizationReference"], message: "Other evidence requires an authorization reference." });
  }
  const { lowerBound, upperBound, interpretation } = record.percent;
  if (record.sourceDocumentType === "SDS" && record.sourceSectionNumber === 3) {
    context.addIssue({ code: "custom", path: ["sourceSectionNumber"], message: "SDS Section 3 hazard-disclosure composition cannot support active matter, solids or assay." });
  }
  if (interpretation === "unparsed") {
    if (lowerBound !== undefined || upperBound !== undefined) {
      context.addIssue({ code: "custom", path: ["percent"], message: "Unparsed product claims cannot contain normalized bounds." });
    }
    if (parseExplicitPercent(record.originalValue)) {
      context.addIssue({ code: "custom", path: ["percent", "interpretation"], message: "Explicit percent source values cannot be labeled unparsed." });
    }
    return;
  }
  if (lowerBound === undefined || upperBound === undefined) {
    context.addIssue({ code: "custom", path: ["percent"], message: "Parsed product claims require both bounds." });
    return;
  }
  if (upperBound < lowerBound || (interpretation === "exact" && lowerBound !== upperBound)
    || (interpretation === "range" && lowerBound >= upperBound)) {
    context.addIssue({ code: "custom", path: ["percent"], message: "Exact or ranged product claim bounds are inconsistent." });
  }
  const parsedSource = parseExplicitPercent(record.originalValue);
  if (!parsedSource || parsedSource.lowerBound !== lowerBound || parsedSource.upperBound !== upperBound) {
    context.addIssue({ code: "custom", path: ["percent"], message: "Normalized product claim bounds must match the explicit source percent value." });
  }
});

export type AuthorizedProductClaimInput = z.infer<typeof authorizedProductClaimInputSchema>;
export type ActiveMatterEvidence = z.infer<typeof activeMatterEvidenceSchema>;

/** Check a stored provisional claim against the exact extracted source-fact envelope. */
export function validateActiveMatterEvidenceAgainstSource(
  recordInput: ActiveMatterEvidence,
  sourceInput: AuthorizedProductClaimInput,
): ActiveMatterEvidence {
  const record = activeMatterEvidenceSchema.parse(recordInput);
  const source = authorizedProductClaimInputSchema.parse(sourceInput);
  const matching = record.commercialProductId === source.commercialProductId
    && record.sourceDocumentType === source.sourceDocumentType
    && record.sourceDocumentHash === source.sourceDocumentHash
    && record.sourceEvidenceId === source.sourceEvidenceId
    && record.sourceSectionNumber === source.sourceSectionNumber
    && record.sourceFactId === source.sourceFactId
    && record.quantityKind === source.quantityKind
    && record.explicitPropertyLabel === source.explicitPropertyLabel
    && record.originalValue === source.originalValue
    && record.basis === source.basis
    && record.authorizationReference === source.authorizationReference
    && record.evidenceRefs.length === source.evidenceRefs.length
    && record.evidenceRefs.every((ref, index) => ref === source.evidenceRefs[index]);
  if (!matching) throw new Error("Active matter evidence lineage does not match its extracted source claim.");
  return record;
}

function parseExplicitPercent(rawValue: string): { lowerBound: number; upperBound: number } | undefined {
  const match = rawValue.match(/^\s*(?<lower>\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(?<upper>\d+(?:[.,]\d+)?))?\s*%\s*$/u);
  if (!match?.groups) return undefined;
  const lowerBound = Number(match.groups.lower!.replace(",", "."));
  const upperBound = Number((match.groups.upper ?? match.groups.lower)!.replace(",", "."));
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound) || lowerBound < 0 || upperBound > 100 || upperBound < lowerBound) return undefined;
  return { lowerBound, upperBound };
}

/** Convert an explicitly labeled, cited source claim into a review-only record; never infer from Section 3 ranges. */
export function createActiveMatterEvidence(input: AuthorizedProductClaimInput): ActiveMatterEvidence {
  const claim = authorizedProductClaimInputSchema.parse(input);
  const parsed = parseExplicitPercent(claim.originalValue);
  const record = activeMatterEvidenceSchema.parse({
    ...claim,
    provenanceStatus: "provisional",
    percent: parsed
      ? { ...parsed, interpretation: parsed.lowerBound === parsed.upperBound ? "exact" : "range" }
      : { interpretation: "unparsed" },
    reviewRequired: true,
  });
  return validateActiveMatterEvidenceAgainstSource(record, claim);
}
