/**
 * Regulatory review lifecycle, staleness detection, and evidence
 * confirmation lifecycle — spec §3.1/§3.2/§3.4 closure. A recorded
 * `RegulatoryReview` is only ever useful for exactly what it was
 * recorded against: this module is what actually enforces "version A's
 * review does not satisfy version B", "a working-draft review does not
 * satisfy a saved version", "wrong jurisdiction/packaging SKU never
 * silently matches", and "a review recorded against old rule versions is
 * flagged stale, never silently treated as current."
 */
import { newId } from "./versioning";
import type { Actor } from "../schemas/status";
import {
  activeReviewEquivalencesFor,
  type RegulatoryEvidenceConfirmation,
  type RegulatoryEvidenceConfirmationRevocation,
  type RegulatoryEvidenceConfirmationStatus,
  type RegulatoryJurisdiction,
  type RegulatoryReview,
  type RegulatoryReviewEquivalence,
  type RegulatoryReviewRevocation,
  type RegulatoryRequirementType,
  type RegulatoryRule,
  type RegulatoryRuleVersionSnapshot,
} from "../schemas/regulatory";

export const REGULATORY_REVIEW_STATUSES = [
  "current",
  "stale_formula_version",
  "stale_rule_version",
  "wrong_jurisdiction",
  "wrong_packaging_sku",
  "revoked",
  "superseded",
  "unknown",
] as const;
export type RegulatoryReviewStatus = (typeof REGULATORY_REVIEW_STATUSES)[number];

export interface RegulatoryReviewContext {
  formulaVersionId: string;
  jurisdiction: RegulatoryJurisdiction;
  packagingSkuCode?: string;
}

function requireHuman(actor: Actor, action: string): asserts actor is Extract<Actor, { kind: "human" }> {
  if (actor.kind !== "human") throw new Error(`Only a human may ${action}.`);
}

function requireRegulatoryRole(actor: Actor, action: string): asserts actor is Extract<Actor, { kind: "human" }> {
  requireHuman(actor, action);
  if (actor.role !== "regulatory" && actor.role !== "quality" && actor.role !== "administrator") {
    throw new Error(`Only an authorized regulatory/quality/administrator role may ${action}.`);
  }
}

/**
 * Does `review.ruleVersionSnapshot` still match what `currentRules` say
 * today? A rule the snapshot references but that no longer exists (id
 * unknown) counts as changed too — never silently ignored. Returns the
 * specific rule ids that drifted so a UI can show exactly what changed,
 * not just "something did."
 */
export function compareReviewRuleSnapshotToCurrentRules(
  snapshot: RegulatoryRuleVersionSnapshot[],
  currentRules: RegulatoryRule[],
): { stale: boolean; changedRuleIds: string[] } {
  const byId = new Map(currentRules.map((r) => [r.id, r]));
  const changedRuleIds = snapshot
    .filter((s) => {
      const current = byId.get(s.ruleId);
      return !current || current.version !== s.version;
    })
    .map((s) => s.ruleId);
  return { stale: changedRuleIds.length > 0, changedRuleIds };
}

/**
 * The full, honest status of one review against a specific context. Never
 * collapses "I'm not sure" into "current" — every non-matching dimension
 * gets its own specific status rather than a generic "not valid".
 */
export function deriveRegulatoryReviewStatus(
  review: RegulatoryReview,
  ctx: RegulatoryReviewContext,
  revocations: RegulatoryReviewRevocation[],
  allReviewsInScope: RegulatoryReview[],
  currentRules: RegulatoryRule[],
): RegulatoryReviewStatus {
  if (revocations.some((r) => r.revokesReviewId === review.id)) return "revoked";

  const supersededBy = allReviewsInScope.find(
    (other) =>
      other.id !== review.id &&
      other.formulaVersionId === review.formulaVersionId &&
      other.jurisdiction === review.jurisdiction &&
      other.packagingSkuCode === review.packagingSkuCode &&
      other.reviewedAt > review.reviewedAt &&
      !revocations.some((r) => r.revokesReviewId === other.id),
  );
  if (supersededBy) return "superseded";

  if (review.jurisdiction !== ctx.jurisdiction) return "wrong_jurisdiction";
  if (review.packagingSkuCode !== ctx.packagingSkuCode) return "wrong_packaging_sku";
  if (review.formulaVersionId !== ctx.formulaVersionId) return "stale_formula_version";

  const { stale } = compareReviewRuleSnapshotToCurrentRules(review.ruleVersionSnapshot, currentRules);
  if (stale) return "stale_rule_version";

  return "current";
}

export function isRegulatoryReviewCurrent(
  review: RegulatoryReview,
  ctx: RegulatoryReviewContext,
  revocations: RegulatoryReviewRevocation[],
  allReviewsInScope: RegulatoryReview[],
  currentRules: RegulatoryRule[],
): boolean {
  return deriveRegulatoryReviewStatus(review, ctx, revocations, allReviewsInScope, currentRules) === "current";
}

export interface ApplicableRegulatoryReview {
  review: RegulatoryReview;
  status: RegulatoryReviewStatus;
  /** Set when this review only applies because an explicit
   *  `RegulatoryReviewEquivalence` permits reuse from a different source
   *  version — never assumed, always the id of the declaration that
   *  authorized it. */
  reusedViaEquivalenceId?: string;
}

/**
 * The best review applicable to `ctx` — a direct match first (still
 * requiring `deriveRegulatoryReviewStatus` to actually confirm "current"),
 * falling back to a review reused via an active
 * `RegulatoryReviewEquivalence` declared for this exact target version/
 * jurisdiction/packaging SKU. Returns `undefined` when nothing applies —
 * callers must treat that as "no review", never guess one is implied.
 */
export function findApplicableRegulatoryReview(
  ctx: RegulatoryReviewContext,
  reviews: RegulatoryReview[],
  revocations: RegulatoryReviewRevocation[],
  reviewEquivalences: RegulatoryReviewEquivalence[],
  currentRules: RegulatoryRule[],
): ApplicableRegulatoryReview | undefined {
  const direct = reviews
    .map((review) => ({ review, status: deriveRegulatoryReviewStatus(review, ctx, revocations, reviews, currentRules) }))
    .find((r) => r.status === "current");
  if (direct) return direct;

  for (const equivalence of activeReviewEquivalencesFor(ctx.formulaVersionId, reviewEquivalences)) {
    if (equivalence.jurisdiction !== ctx.jurisdiction) continue;
    if (equivalence.packagingSkuCode !== ctx.packagingSkuCode) continue;
    const sourceCtx: RegulatoryReviewContext = {
      formulaVersionId: equivalence.sourceVersionId,
      jurisdiction: ctx.jurisdiction,
      packagingSkuCode: ctx.packagingSkuCode,
    };
    const reused = reviews
      .map((review) => ({ review, status: deriveRegulatoryReviewStatus(review, sourceCtx, revocations, reviews, currentRules) }))
      .find((r) => r.status === "current");
    if (reused) return { ...reused, reusedViaEquivalenceId: equivalence.id };
  }

  return undefined;
}

/**
 * The single most useful status to SHOW when no review currently applies
 * — never a bland "unknown" when a specific reason is knowable. Picks the
 * most recently recorded review (across any version/jurisdiction/SKU) and
 * reports its status against `ctx`; `"unknown"` only when there is truly
 * no review at all to explain from.
 */
export function explainRegulatoryReviewStatus(
  ctx: RegulatoryReviewContext,
  reviews: RegulatoryReview[],
  revocations: RegulatoryReviewRevocation[],
  currentRules: RegulatoryRule[],
): RegulatoryReviewStatus {
  if (reviews.length === 0) return "unknown";
  const statuses = reviews.map((r) => deriveRegulatoryReviewStatus(r, ctx, revocations, reviews, currentRules));
  if (statuses.includes("current")) return "current";
  const mostRecent = [...reviews].sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1))[0];
  return deriveRegulatoryReviewStatus(mostRecent, ctx, revocations, reviews, currentRules);
}

// ---------------------------------------------------------------------------
// Review recording / revocation — human-gated, append-only. Only a
// regulatory/quality/administrator role may record the final sign-off —
// spec: "AI, system and import actors cannot record a final human
// regulatory review."
// ---------------------------------------------------------------------------

export interface RecordRegulatoryReviewInput {
  formulationId: string;
  formulaVersionId: string;
  jurisdiction: RegulatoryJurisdiction;
  packagingSkuCode?: string;
  classificationSnapshot: RegulatoryReview["classificationSnapshot"];
  findingSnapshot: RegulatoryReview["findingSnapshot"];
  ruleVersionSnapshot: RegulatoryRuleVersionSnapshot[];
  outcome: RegulatoryReview["outcome"];
  notes: string;
}

/** Builds and returns a new `RegulatoryReview` — never mutates or reuses
 *  an existing one. */
export function recordRegulatoryReview(input: RecordRegulatoryReviewInput, actor: Actor): RegulatoryReview {
  requireRegulatoryRole(actor, "record a regulatory review");
  if (!input.formulaVersionId.trim()) throw new Error("A regulatory review must be recorded against a real, saved formula version id.");
  if (!input.notes.trim()) throw new Error("Regulatory review notes are required.");
  return {
    schemaVersion: "1.0",
    id: newId("regreview"),
    formulationId: input.formulationId,
    formulaVersionId: input.formulaVersionId,
    jurisdiction: input.jurisdiction,
    packagingSkuCode: input.packagingSkuCode,
    classificationSnapshot: input.classificationSnapshot,
    findingSnapshot: input.findingSnapshot,
    ruleVersionSnapshot: input.ruleVersionSnapshot,
    reviewedBy: actor.userId,
    reviewerRole: actor.role,
    reviewedAt: new Date().toISOString(),
    outcome: input.outcome,
    notes: input.notes.trim(),
  };
}

export function revokeRegulatoryReview(reviewId: string, actor: Actor, reason: string): RegulatoryReviewRevocation {
  requireRegulatoryRole(actor, "revoke a regulatory review");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to revoke a regulatory review.");
  return {
    schemaVersion: "1.0",
    id: newId("regreviewrevoke"),
    revokesReviewId: reviewId,
    revokedBy: actor.userId,
    revokedByRole: actor.role,
    revokedAt: new Date().toISOString(),
    reason: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Evidence confirmations — human-gated, append-only, version/jurisdiction/
// packaging-SKU-specific.
// ---------------------------------------------------------------------------

export interface RecordEvidenceConfirmationInput {
  formulationId: string;
  formulaVersionId: string;
  jurisdiction: RegulatoryJurisdiction;
  packagingSkuCode?: string;
  ruleId?: string;
  requirementType: RegulatoryRequirementType;
  requirementCode: string;
  status: RegulatoryEvidenceConfirmationStatus;
  notes?: string;
  attachmentIds?: string[];
  /** Set when this confirmation corrects an earlier one for the same
   *  requirement — the earlier one is superseded, never overwritten. */
  revokesConfirmationId?: string;
}

export function recordEvidenceConfirmation(input: RecordEvidenceConfirmationInput, actor: Actor): RegulatoryEvidenceConfirmation {
  requireHuman(actor, "confirm regulatory evidence");
  if (!input.formulaVersionId.trim()) throw new Error("An evidence confirmation must be recorded against a real, saved formula version id.");
  if (!input.requirementCode.trim()) throw new Error("A requirement code is required.");
  return {
    id: newId("regconfirm"),
    schemaVersion: "1.0",
    formulationId: input.formulationId,
    formulaVersionId: input.formulaVersionId,
    jurisdiction: input.jurisdiction,
    packagingSkuCode: input.packagingSkuCode,
    ruleId: input.ruleId,
    requirementType: input.requirementType,
    requirementCode: input.requirementCode,
    status: input.status,
    confirmedBy: actor.userId,
    reviewerRole: actor.role,
    confirmedAt: new Date().toISOString(),
    notes: input.notes,
    attachmentIds: input.attachmentIds ?? [],
    revokesConfirmationId: input.revokesConfirmationId,
  };
}

export function revokeEvidenceConfirmation(confirmationId: string, actor: Actor, reason: string): RegulatoryEvidenceConfirmationRevocation {
  requireHuman(actor, "revoke an evidence confirmation");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to revoke an evidence confirmation.");
  return {
    id: newId("regconfirmrevoke"),
    schemaVersion: "1.0",
    revokesConfirmationId: confirmationId,
    revokedBy: actor.userId,
    revokedByRole: actor.role,
    revokedAt: new Date().toISOString(),
    reason: trimmed,
  };
}

// ---------------------------------------------------------------------------
// Regulatory review equivalence reuse — spec §3.8.
// ---------------------------------------------------------------------------

export interface DeclareRegulatoryReviewEquivalenceInput {
  formulationId: string;
  targetVersionId: string;
  sourceVersionId: string;
  jurisdiction: RegulatoryJurisdiction;
  packagingSkuCode?: string;
  justification: string;
}

export function declareRegulatoryReviewEquivalence(input: DeclareRegulatoryReviewEquivalenceInput, actor: Actor): RegulatoryReviewEquivalence {
  requireHuman(actor, "declare a regulatory review equivalence");
  const trimmed = input.justification.trim();
  if (!trimmed) throw new Error("A justification is required to declare a regulatory review equivalence.");
  if (input.sourceVersionId === input.targetVersionId) throw new Error("A version cannot be declared equivalent to itself.");
  return {
    schemaVersion: "1.0",
    id: newId("regrevequiv"),
    formulationId: input.formulationId,
    targetVersionId: input.targetVersionId,
    sourceVersionId: input.sourceVersionId,
    jurisdiction: input.jurisdiction,
    packagingSkuCode: input.packagingSkuCode,
    justification: trimmed,
    declaredBy: actor.userId,
    declaredByRole: actor.role,
    declaredAt: new Date().toISOString(),
  };
}

/** Revocation is itself a new, immutable record — the original
 *  declaration is never edited or deleted. */
export function revokeRegulatoryReviewEquivalence(
  equivalence: RegulatoryReviewEquivalence,
  actor: Actor,
  reason: string,
): RegulatoryReviewEquivalence {
  requireHuman(actor, "revoke a regulatory review equivalence");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason is required to revoke a regulatory review equivalence.");
  if (equivalence.revokesEquivalenceId) throw new Error("A revocation record cannot itself be revoked.");
  return {
    schemaVersion: "1.0",
    id: newId("regrevequiv"),
    formulationId: equivalence.formulationId,
    targetVersionId: equivalence.targetVersionId,
    sourceVersionId: equivalence.sourceVersionId,
    jurisdiction: equivalence.jurisdiction,
    packagingSkuCode: equivalence.packagingSkuCode,
    justification: equivalence.justification,
    declaredBy: actor.userId,
    declaredByRole: actor.role,
    declaredAt: new Date().toISOString(),
    revokesEquivalenceId: equivalence.id,
    revocationReason: trimmed,
  };
}
