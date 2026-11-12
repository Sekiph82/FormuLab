import { z } from "zod";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";
import { identityFieldReviewSchema, type IdentityFieldReview } from "./identityFieldReview";
import { isAuthorizedIdentityFieldReviewer } from "./identityFieldReview";
import type { Actor } from "./status";

export const RESOLVER_KINDS = ["single_component", "solution", "polymer", "blend", "proprietary_disclosure"] as const;
const jsonSnapshot = z.string().min(1).refine((value) => {
  try { JSON.parse(value); return true; } catch { return false; }
}, "Resolution snapshots must contain valid JSON.");

export const resolverResolutionRevisionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  resolverKind: z.enum(RESOLVER_KINDS),
  revision: z.number().int().positive(),
  previousResolutionId: z.string().trim().min(1).optional(),
  sourceEvidenceId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceRevisionDate: z.string().date().optional(),
  resolutionSnapshot: jsonSnapshot,
  comparisonToPrior: z.enum(["initial", "unchanged", "changed", "source_order_unknown", "source_not_newer"]),
  reviewStatus: z.literal("needs_review"),
  reviewRequired: z.literal(true),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((revision, context) => {
  if ((revision.revision === 1) !== (revision.previousResolutionId === undefined)) {
    context.addIssue({ code: "custom", path: ["previousResolutionId"], message: "Revision one has no predecessor; later revisions require one." });
  }
  if (revision.revision === 1 && revision.comparisonToPrior !== "initial") {
    context.addIssue({ code: "custom", path: ["comparisonToPrior"], message: "An initial resolution must use the initial comparison state." });
  }
  if (revision.revision > 1 && revision.comparisonToPrior === "initial") {
    context.addIssue({ code: "custom", path: ["comparisonToPrior"], message: "A later resolution cannot use the initial comparison state." });
  }
});

export type ResolverResolutionRevision = z.infer<typeof resolverResolutionRevisionSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Create a new immutable resolution candidate; the previous revision is never edited or accepted implicitly. */
export function createResolverResolutionRevision(input: {
  previous?: ResolverResolutionRevision;
  source: SupplierSdsProductEvidence;
  resolverKind: ResolverResolutionRevision["resolverKind"];
  sourceRevisionDate?: string;
  resolutionSnapshot: string;
  id: string;
  createdAt: string;
}): ResolverResolutionRevision {
  const source = supplierSdsProductEvidenceSchema.parse(input.source);
  const snapshot = JSON.parse(jsonSnapshot.parse(input.resolutionSnapshot)) as unknown;
  const previous = input.previous ? resolverResolutionRevisionSchema.parse(input.previous) : undefined;
  if (previous) {
    if (previous.commercialProductId !== source.commercialProductId || previous.resolverKind !== input.resolverKind) {
      throw new Error("A resolver revision must continue the same commercial product and resolver kind.");
    }
    if (previous.sourceDocumentHash.toLowerCase() === source.section1.sourceDocumentHash.toLowerCase()) {
      throw new Error("An identical SDS document hash cannot create a new resolver revision.");
    }
  }
  const previousSnapshot = previous ? JSON.parse(previous.resolutionSnapshot) as unknown : undefined;
  let comparisonToPrior: ResolverResolutionRevision["comparisonToPrior"] = "initial";
  if (previous) {
    if (!previous.sourceRevisionDate || !input.sourceRevisionDate) comparisonToPrior = "source_order_unknown";
    else if (input.sourceRevisionDate <= previous.sourceRevisionDate) comparisonToPrior = "source_not_newer";
    else comparisonToPrior = canonicalJson(snapshot) === canonicalJson(previousSnapshot) ? "unchanged" : "changed";
  }
  return resolverResolutionRevisionSchema.parse({
    schemaVersion: "1.0",
    id: input.id,
    commercialProductId: source.commercialProductId,
    resolverKind: input.resolverKind,
    revision: previous ? previous.revision + 1 : 1,
    ...(previous ? { previousResolutionId: previous.id } : {}),
    sourceEvidenceId: source.id,
    sourceDocumentHash: source.section1.sourceDocumentHash.toLowerCase(),
    ...(input.sourceRevisionDate ? { sourceRevisionDate: input.sourceRevisionDate } : {}),
    resolutionSnapshot: JSON.stringify(snapshot),
    comparisonToPrior,
    reviewStatus: "needs_review",
    reviewRequired: true,
    createdAt: input.createdAt,
  });
}

export const referenceFormulaMappingRevisionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  mappingId: z.string().trim().min(1),
  revision: z.number().int().positive(),
  previousMappingRevisionId: z.string().trim().min(1).optional(),
  formulaId: z.string().trim().min(1),
  formulaLineId: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  resolverRevisionId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  acceptedReviewId: z.string().trim().min(1),
  normalizedMappingSnapshot: jsonSnapshot,
  reviewedBy: z.string().trim().min(1),
  reviewerRole: z.string().trim().min(1),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((mapping, context) => {
  if ((mapping.revision === 1) !== (mapping.previousMappingRevisionId === undefined)) {
    context.addIssue({ code: "custom", path: ["previousMappingRevisionId"], message: "Mapping revision one has no predecessor; later revisions require one." });
  }
});

export type ReferenceFormulaMappingRevision = z.infer<typeof referenceFormulaMappingRevisionSchema>;

/** Update a normalized reference-formula mapping only after a cited human acceptance; prior mapping records remain immutable. */
export function createReferenceFormulaMappingRevision(input: {
  prior?: ReferenceFormulaMappingRevision;
  resolution: ResolverResolutionRevision;
  review: IdentityFieldReview;
  reviewer: Actor;
  formulaId: string;
  formulaLineId: string;
  mappingId: string;
  id: string;
  normalizedMappingSnapshot: string;
  reviewedAt: string;
}): ReferenceFormulaMappingRevision {
  const resolution = resolverResolutionRevisionSchema.parse(input.resolution);
  const review = identityFieldReviewSchema.parse(input.review);
  const prior = input.prior ? referenceFormulaMappingRevisionSchema.parse(input.prior) : undefined;
  if (!isAuthorizedIdentityFieldReviewer(input.reviewer)
    || review.reviewedBy !== input.reviewer.userId || review.reviewerRole !== input.reviewer.role) {
    throw new Error("The mapping revision requires the same currently authorized human who recorded the accepted review.");
  }
  if (review.decision !== "accepted" || !["canonical_identity", "component"].includes(review.field)
    || review.commercialProductId !== resolution.commercialProductId || review.sourceEvidenceId !== resolution.sourceEvidenceId
    || review.targetRecordId !== input.mappingId) {
    throw new Error("A mapping revision requires an accepted identity review tied to the same product and resolver source evidence.");
  }
  if (canonicalJson(JSON.parse(review.proposedValueSnapshot)) !== canonicalJson(JSON.parse(input.normalizedMappingSnapshot))) {
    throw new Error("The accepted review value must exactly match the normalized formula mapping snapshot.");
  }
  if (prior && (prior.mappingId !== input.mappingId || prior.formulaId !== input.formulaId || prior.formulaLineId !== input.formulaLineId
    || prior.commercialProductId !== resolution.commercialProductId)) {
    throw new Error("A mapping revision must continue the same historical formula-line mapping.");
  }
  return referenceFormulaMappingRevisionSchema.parse({
    schemaVersion: "1.0",
    id: input.id,
    mappingId: input.mappingId,
    revision: prior ? prior.revision + 1 : 1,
    ...(prior ? { previousMappingRevisionId: prior.id } : {}),
    formulaId: input.formulaId,
    formulaLineId: input.formulaLineId,
    commercialProductId: resolution.commercialProductId,
    resolverRevisionId: resolution.id,
    sourceEvidenceId: resolution.sourceEvidenceId,
    sourceDocumentHash: resolution.sourceDocumentHash,
    acceptedReviewId: review.id,
    normalizedMappingSnapshot: jsonSnapshot.parse(input.normalizedMappingSnapshot),
    reviewedBy: review.reviewedBy,
    reviewerRole: review.reviewerRole,
    reviewedAt: input.reviewedAt,
  });
}
