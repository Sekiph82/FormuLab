// Phase 4 — claim lifecycle, rule evaluation and evidence-satisfaction
// engine. Mirrors `engine/regulatoryDossier.ts`'s shape deliberately: the
// same append-only-link / frozen-review-snapshot / "unknown is contagious"
// conventions apply here, just at the claim level instead of the
// requirement level. See docs/PRODUCT_CLAIMS.md.
import { newId } from "./versioning";
import { requireAuthorizedRegulatoryActor, requireHumanActor } from "./regulatoryAuthorization";
import type { Actor } from "../schemas/status";
import type { RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";
import type { RegulatoryDossierEvidenceItem } from "../schemas/dossier";
import {
  CLAIM_CATEGORIES,
  CLAIM_IMMUTABLE_STATUSES,
  type ClaimCategory,
  type ClaimEvidenceLink,
  type ClaimFinding,
  type ClaimReview,
  type ClaimReviewRevocation,
  type ClaimRiskLevel,
  type ClaimsReadiness,
  type ClaimStatus,
  type ProductClaim,
} from "../schemas/claimsLabels";

// ---------------------------------------------------------------------------
// Text normalization and category classification.
// ---------------------------------------------------------------------------

/** Lowercase, whitespace-collapsed form — used for conflict-finding and
 *  rule-keyword matching, never displayed in place of the original text. */
export function normalizeClaimText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const CATEGORY_KEYWORDS: Partial<Record<ClaimCategory, string[]>> = {
  antibacterial: ["antibacterial", "kills bacteria", "bacteria"],
  antimicrobial: ["antimicrobial", "microbial"],
  disinfectant: ["disinfect", "disinfectant"],
  germ_kill: ["kills germs", "germ kill", "99.9%", "kills 99"],
  medical: ["cures", "treats", "medical", "medicine"],
  therapeutic: ["therapeutic", "therapy"],
  dermatological: ["dermatologist", "dermatological", "clinically tested"],
  hypoallergenic: ["hypoallergenic"],
  sensitive: ["sensitive skin", "sensitive"],
  baby_safe: ["baby safe", "safe for babies", "baby"],
  child_safe: ["child safe", "safe for children"],
  natural: ["natural", "all-natural"],
  organic: ["organic"],
  biodegradable: ["biodegradable"],
  flushable: ["flushable"],
  vegan: ["vegan"],
  cruelty_free: ["cruelty free", "cruelty-free", "not tested on animals"],
  whitening: ["whitening", "whitens"],
  brightening: ["brightening", "brightens"],
  stain_removal: ["stain removal", "removes stains"],
  odor_control: ["odor control", "odour control", "eliminates odor"],
  long_lasting: ["long lasting", "long-lasting", "24 hour", "24-hour"],
  concentrated: ["concentrated", "concentrate"],
  eco: ["eco-friendly", "eco friendly", "environmentally friendly"],
  free_from: ["free from", "paraben free", "sulfate free", "fragrance free"],
  comparative: ["better than", "more than", "outperforms", "compared to"],
  professional: ["professional grade", "salon grade", "professional"],
};

/** Deterministic keyword classification — never guesses beyond what the
 *  claim text literally contains, and returns `"other"` rather than a
 *  fabricated best-guess category when nothing matches. */
export function classifyClaimCategory(claimText: string): ClaimCategory {
  const normalized = normalizeClaimText(claimText);
  for (const category of CLAIM_CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[category];
    if (keywords?.some((k) => normalized.includes(k))) return category;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Claim lifecycle.
// ---------------------------------------------------------------------------

export function isClaimImmutable(claim: Pick<ProductClaim, "status">): boolean {
  return (CLAIM_IMMUTABLE_STATUSES as readonly ClaimStatus[]).includes(claim.status);
}

export interface CreateClaimInput {
  claimCode: string;
  claimText: string;
  claimCategory?: ClaimCategory;
  formulationId: string;
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdictions: RegulatoryJurisdiction[];
  languages: string[];
}

/** Any human role may draft a claim — formal review is a separate,
 *  authorized-role-only step (`recordClaimReview`). */
export function createClaim(input: CreateClaimInput, actor: Actor): ProductClaim {
  requireHumanActor(actor, "create a product claim");
  if (!input.formulaVersionId.trim()) throw new Error("A claim must be recorded against a real, saved formula version id.");
  if (input.jurisdictions.length === 0) throw new Error("A claim must name at least one jurisdiction.");
  if (input.languages.length === 0) throw new Error("A claim must name at least one language.");
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    id: newId("claim"),
    claimCode: input.claimCode,
    claimText: input.claimText,
    normalizedClaim: normalizeClaimText(input.claimText),
    claimCategory: input.claimCategory ?? classifyClaimCategory(input.claimText),
    formulationId: input.formulationId,
    formulaVersionId: input.formulaVersionId,
    packagingSkuCode: input.packagingSkuCode,
    jurisdictions: input.jurisdictions,
    languages: input.languages,
    status: "draft",
    riskLevel: "unknown",
    proposedBy: actor.userId,
    proposedAt: now,
    updatedAt: now,
  };
}

export function updateClaimStatus(claim: ProductClaim, to: ClaimStatus, actor: Actor): ProductClaim {
  requireHumanActor(actor, "change a claim's status");
  if (isClaimImmutable(claim)) throw new Error(`Claim ${claim.claimCode} is ${claim.status} and immutable — create a new revision instead of changing its status.`);
  return { ...claim, status: to, updatedBy: actor.userId, updatedAt: new Date().toISOString() };
}

/** Creates a new claim revision superseding the current one — required
 *  whenever the claim text/category/scope changes after a formal review.
 *  The old row's own `status` becomes `"superseded"`; it is never edited
 *  otherwise or deleted. */
export function reviseClaim(current: ProductClaim, updates: Partial<Pick<ProductClaim, "claimText" | "claimCategory" | "jurisdictions" | "languages" | "packagingSkuCode">>, actor: Actor): { superseded: ProductClaim; revised: ProductClaim } {
  requireHumanActor(actor, "revise a claim");
  const now = new Date().toISOString();
  const superseded: ProductClaim = { ...current, status: "superseded", updatedBy: actor.userId, updatedAt: now };
  const newText = updates.claimText ?? current.claimText;
  const revised: ProductClaim = {
    ...current,
    ...updates,
    id: newId("claim"),
    claimText: newText,
    normalizedClaim: normalizeClaimText(newText),
    status: "draft",
    supersedesClaimId: current.id,
    proposedBy: actor.userId,
    proposedAt: now,
    updatedBy: undefined,
    updatedAt: now,
  };
  return { superseded, revised };
}

/** The effective status of a claim — `"superseded"` whenever a later
 *  claim's `supersedesClaimId` points back at it, regardless of its own
 *  stored status, same overlay pattern `deriveDossierStatus` uses. */
export function deriveClaimEffectiveStatus(claim: ProductClaim, allClaimsInScope: ProductClaim[]): ClaimStatus {
  const supersededBy = allClaimsInScope.some((c) => c.supersedesClaimId === claim.id);
  return supersededBy ? "superseded" : claim.status;
}

// ---------------------------------------------------------------------------
// Rule evaluation — reuses the existing RegulatoryRule.claimKeywordsAny
// field `evaluateRegulatory` already uses for formula-level claims; this is
// the same real, configured data applied at the individual-claim level.
// ---------------------------------------------------------------------------

const HIGH_RISK_CATEGORIES: readonly ClaimCategory[] = ["medical", "therapeutic", "antibacterial", "antimicrobial", "disinfectant", "germ_kill"];

export interface ClaimRuleEvaluationContext {
  jurisdictions: RegulatoryJurisdiction[];
  rules: RegulatoryRule[];
}

/** Never invents legislation — only flags a finding when a real, configured
 *  `RegulatoryRule.claimKeywordsAny` entry appears in the claim's
 *  normalized text, or when the claim's own category is inherently
 *  high-risk (medical/therapeutic/antimicrobial/disinfectant/germ-kill),
 *  which always requires human review regardless of rule coverage. */
export function evaluateClaimAgainstRules(claim: ProductClaim, ctx: ClaimRuleEvaluationContext): ClaimFinding[] {
  const findings: ClaimFinding[] = [];
  for (const jurisdiction of claim.jurisdictions) {
    if (!ctx.jurisdictions.includes(jurisdiction)) continue;
    for (const language of claim.languages) {
      const applicableRules = ctx.rules.filter(
        (r) => r.active && r.status !== "deprecated" && (r.jurisdiction === jurisdiction || r.jurisdiction === "EAC") && r.claimKeywordsAny.some((kw) => claim.normalizedClaim.includes(normalizeClaimText(kw))),
      );
      for (const rule of applicableRules) {
        findings.push({
          claimId: claim.id,
          jurisdiction,
          language,
          ruleId: rule.id,
          ruleVersion: rule.version,
          findingType: rule.severity === "blocking" ? "prohibited" : "restricted",
          severity: rule.severity === "blocking" ? "blocking" : "warning",
          status: rule.severity === "blocking" ? "prohibited" : "restricted",
          message: rule.requirement,
          requiredEvidence: rule.requiredEvidenceTypes,
          conditions: [],
          humanReviewRequired: rule.verificationStatus !== "verified",
        });
      }
      if (HIGH_RISK_CATEGORIES.includes(claim.claimCategory)) {
        findings.push({
          claimId: claim.id,
          jurisdiction,
          language,
          findingType: "high_risk_claim",
          severity: "warning",
          status: "under_review",
          message: `"${claim.claimCategory}" claims always require qualified human review regardless of configured rules.`,
          requiredEvidence: [],
          conditions: [],
          humanReviewRequired: true,
        });
      }
      if (claim.claimCategory === "comparative") {
        findings.push({
          claimId: claim.id,
          jurisdiction,
          language,
          findingType: "comparative_claim",
          severity: "warning",
          status: "under_review",
          message: "Comparative claims require substantiation against the specific named comparator.",
          requiredEvidence: [],
          conditions: [],
          humanReviewRequired: true,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Evidence link lifecycle — reuses Phase 3 dossier evidence items directly,
// never duplicates a file. Same authorization split as
// `regulatoryDossier.ts`'s requirement-evidence links: any human may
// propose/accept/reject/revoke a link (spec §4.4-equivalent — "a human must
// accept the mapping"), only an authorized regulatory actor may verify the
// underlying evidence itself (that gate already lives in
// `regulatoryDossier.ts`'s `verifyEvidence`).
// ---------------------------------------------------------------------------

export function proposeClaimEvidenceLink(claimId: string, evidenceItemId: string, dossierId: string, dossierRevision: number, actor: Actor): ClaimEvidenceLink {
  requireHumanActor(actor, "propose a claim evidence link");
  return {
    schemaVersion: "1.0",
    id: newId("claimevidencelink"),
    claimId,
    evidenceItemId,
    dossierId,
    dossierRevision,
    linkStatus: "proposed",
    linkedBy: actor.userId,
    linkedAt: new Date().toISOString(),
  };
}

export function acceptClaimEvidenceLink(link: ClaimEvidenceLink, actor: Actor): ClaimEvidenceLink {
  requireHumanActor(actor, "accept a claim evidence link");
  return { ...link, id: newId("claimevidencelink"), linkStatus: "accepted", reviewedBy: actor.userId, reviewedAt: new Date().toISOString() };
}

export function rejectClaimEvidenceLink(link: ClaimEvidenceLink, actor: Actor, notes: string): ClaimEvidenceLink {
  requireHumanActor(actor, "reject a claim evidence link");
  if (!notes.trim()) throw new Error("A reason is required to reject a claim evidence link.");
  return { ...link, id: newId("claimevidencelink"), linkStatus: "rejected", reviewedBy: actor.userId, reviewedAt: new Date().toISOString(), notes };
}

export function revokeClaimEvidenceLink(link: ClaimEvidenceLink, actor: Actor, notes: string): ClaimEvidenceLink {
  requireHumanActor(actor, "revoke a claim evidence link");
  if (!notes.trim()) throw new Error("A reason is required to revoke a claim evidence link.");
  return {
    schemaVersion: "1.0",
    id: newId("claimevidencelink"),
    claimId: link.claimId,
    evidenceItemId: link.evidenceItemId,
    dossierId: link.dossierId,
    dossierRevision: link.dossierRevision,
    linkStatus: "revoked",
    linkedBy: actor.userId,
    linkedAt: new Date().toISOString(),
    notes,
    revokesLinkId: link.id,
  };
}

/** Latest row per `(claimId, evidenceItemId)` pair, excluding revoked —
 *  same overlay convention as `activeLinksForDossier`. */
export function activeLinksForClaim(links: ClaimEvidenceLink[], claimId: string): ClaimEvidenceLink[] {
  const forClaim = links.filter((l) => l.claimId === claimId);
  const latestByPair = new Map<string, ClaimEvidenceLink>();
  for (const link of forClaim) {
    const key = link.evidenceItemId;
    const existing = latestByPair.get(key);
    if (!existing || link.linkedAt >= existing.linkedAt) latestByPair.set(key, link);
  }
  return Array.from(latestByPair.values()).filter((l) => l.linkStatus !== "revoked");
}

export interface ClaimEvidenceEligibilityContext {
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdictions: RegulatoryJurisdiction[];
}

/** Mirrors `evaluateEvidenceEligibility` — an evidence item cannot support
 *  a claim just because a link exists; it must actually be eligible for
 *  this exact scope and not expired/rejected/revoked/superseded. */
export function evaluateClaimEvidenceEligibility(evidence: RegulatoryDossierEvidenceItem, ctx: ClaimEvidenceEligibilityContext): { eligible: boolean; reason?: string } {
  if (evidence.formulaVersionId !== ctx.formulaVersionId) return { eligible: false, reason: "wrong_version_evidence" };
  if (ctx.packagingSkuCode && evidence.packagingSkuCode && evidence.packagingSkuCode !== ctx.packagingSkuCode) return { eligible: false, reason: "wrong_packaging_evidence" };
  if (!evidence.jurisdictions.some((j) => ctx.jurisdictions.includes(j))) return { eligible: false, reason: "wrong_jurisdiction_evidence" };
  if (evidence.status === "rejected") return { eligible: false, reason: "rejected" };
  if (evidence.status === "revoked") return { eligible: false, reason: "revoked" };
  if (evidence.status === "superseded") return { eligible: false, reason: "superseded" };
  if (evidence.expiresAt && new Date(evidence.expiresAt) < new Date()) return { eligible: false, reason: "expired_evidence" };
  return { eligible: true };
}

export function evaluateClaimEvidence(claim: ProductClaim, links: ClaimEvidenceLink[], evidenceItems: RegulatoryDossierEvidenceItem[], ctx: ClaimEvidenceEligibilityContext): { hasVerifiedEligibleEvidence: boolean; missingEvidence: boolean; findings: ClaimFinding[] } {
  // Only an ACCEPTED link can ever satisfy a claim — a merely proposed
  // (or rejected) link is not "missing evidence" exactly, but it never
  // counts toward satisfaction either. `activeLinksForClaim` only excludes
  // revoked rows (it's the general latest-per-pair overlay used for
  // display), so the "accepted" filter has to happen here.
  const active = activeLinksForClaim(links, claim.id).filter((l) => l.linkStatus === "accepted");
  if (active.length === 0) {
    return {
      hasVerifiedEligibleEvidence: false,
      missingEvidence: true,
      findings: [
        {
          claimId: claim.id,
          jurisdiction: claim.jurisdictions[0],
          language: claim.languages[0],
          findingType: "missing_evidence",
          severity: "blocking",
          status: "unknown",
          message: "No accepted evidence link exists for this claim.",
          requiredEvidence: [],
          conditions: [],
          humanReviewRequired: false,
        },
      ],
    };
  }
  const findings: ClaimFinding[] = [];
  let hasVerifiedEligible = false;
  for (const link of active) {
    const evidence = evidenceItems.find((e) => e.id === link.evidenceItemId);
    if (!evidence) continue;
    const eligibility = evaluateClaimEvidenceEligibility(evidence, ctx);
    if (!eligibility.eligible) {
      findings.push({
        claimId: claim.id,
        jurisdiction: claim.jurisdictions[0],
        language: claim.languages[0],
        findingType: (eligibility.reason as ClaimFinding["findingType"]) ?? "unknown",
        severity: "warning",
        status: "unknown",
        message: `Linked evidence "${evidence.title}" is not eligible for this claim's scope (${eligibility.reason}).`,
        requiredEvidence: [],
        conditions: [],
        humanReviewRequired: false,
      });
      continue;
    }
    if (evidence.status === "verified") hasVerifiedEligible = true;
  }
  return { hasVerifiedEligibleEvidence: hasVerifiedEligible, missingEvidence: false, findings };
}

// ---------------------------------------------------------------------------
// Derived status / risk / readiness.
// ---------------------------------------------------------------------------

/** A computed, advisory status — never overwrites the persisted
 *  `claim.status`, which only a recorded human `ClaimReview` changes.
 *  "Unknown never equals supported": any blocking finding or missing
 *  evidence keeps this away from `"supported"`. */
export function deriveClaimStatus(findings: ClaimFinding[], evidenceState: { hasVerifiedEligibleEvidence: boolean; missingEvidence: boolean }): ClaimStatus {
  if (findings.some((f) => f.findingType === "prohibited")) return "prohibited";
  if (findings.some((f) => f.humanReviewRequired)) return "unknown";
  if (evidenceState.missingEvidence) return "proposed";
  if (findings.some((f) => f.findingType === "restricted")) return "restricted";
  if (!evidenceState.hasVerifiedEligibleEvidence) return "under_review";
  return "supported";
}

export function deriveClaimRisk(claim: ProductClaim, findings: ClaimFinding[]): ClaimRiskLevel {
  if (findings.some((f) => f.findingType === "prohibited")) return "critical";
  if (HIGH_RISK_CATEGORIES.includes(claim.claimCategory)) return "high";
  if (findings.some((f) => f.findingType === "restricted" || f.humanReviewRequired)) return "medium";
  if (findings.length === 0) return "low";
  return "unknown";
}

export interface ClaimConflict {
  claimAId: string;
  claimBId: string;
  reason: "duplicate_text_same_scope";
}

/** Purely informational — flags two active (non-superseded) claims for the
 *  same formula version/jurisdiction with identical normalized text.
 *  Never merges or auto-resolves them; a human decides. */
export function findClaimConflicts(claims: ProductClaim[]): ClaimConflict[] {
  const conflicts: ClaimConflict[] = [];
  const active = claims.filter((c) => deriveClaimEffectiveStatus(c, claims) !== "superseded" && c.status !== "withdrawn" && c.status !== "rejected");
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.formulaVersionId !== b.formulaVersionId) continue;
      if (a.normalizedClaim !== b.normalizedClaim) continue;
      if (!a.jurisdictions.some((j2) => b.jurisdictions.includes(j2))) continue;
      conflicts.push({ claimAId: a.id, claimBId: b.id, reason: "duplicate_text_same_scope" });
    }
  }
  return conflicts;
}

/** A recorded review's frozen snapshot has drifted when the claim itself
 *  has since been updated — mirrors
 *  `compareDossierRequirementsToCurrentRules`'s staleness signal. */
export function compareClaimRevisionToReviewedSnapshot(claim: ProductClaim, review: ClaimReview): boolean {
  return new Date(claim.updatedAt) > new Date(review.reviewedAt);
}

export function calculateClaimsReadiness(claims: ProductClaim[], findingsByClaimId: Map<string, ClaimFinding[]>): ClaimsReadiness {
  const active = claims.filter((c) => deriveClaimEffectiveStatus(c, claims) !== "superseded");
  let supported = 0;
  let unsupported = 0;
  let prohibited = 0;
  let restricted = 0;
  let highRiskUnreviewed = 0;
  let missingEvidence = 0;
  let humanReviewRequired = 0;
  for (const claim of active) {
    const findings = findingsByClaimId.get(claim.id) ?? [];
    if (claim.status === "supported" || claim.status === "supported_with_conditions") supported++;
    else if (claim.status === "prohibited") prohibited++;
    else if (claim.status === "restricted") restricted++;
    else unsupported++;
    if (findings.some((f) => f.findingType === "missing_evidence")) missingEvidence++;
    if (findings.some((f) => f.humanReviewRequired)) humanReviewRequired++;
    if (HIGH_RISK_CATEGORIES.includes(claim.claimCategory) && claim.status !== "supported" && claim.status !== "supported_with_conditions" && claim.status !== "prohibited") highRiskUnreviewed++;
  }
  let overallReadiness: ClaimsReadiness["overallReadiness"];
  if (humanReviewRequired > 0) overallReadiness = "unknown";
  else if (prohibited > 0) overallReadiness = "blocked";
  else if (active.length === 0) overallReadiness = "not_ready";
  else if (unsupported === active.length) overallReadiness = "not_ready";
  else if (supported === active.length) overallReadiness = "ready_for_review";
  else overallReadiness = "partially_ready";
  return {
    totalClaims: active.length,
    supportedClaims: supported,
    unsupportedClaims: unsupported,
    prohibitedClaims: prohibited,
    restrictedClaims: restricted,
    highRiskUnreviewedClaims: highRiskUnreviewed,
    missingEvidenceCount: missingEvidence,
    humanReviewRequiredCount: humanReviewRequired,
    overallReadiness,
  };
}

// ---------------------------------------------------------------------------
// Claim reviews — append-only, exact revision, human-authorized only.
// ---------------------------------------------------------------------------

export interface RecordClaimReviewInput {
  claimId: string;
  claimRevision: number;
  formulationId: string;
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdiction: RegulatoryJurisdiction;
  language: string;
  outcome: ClaimReview["outcome"];
  conditions?: string[];
  notes: string;
  evidenceSnapshot?: ClaimEvidenceLink[];
  ruleSnapshot?: ClaimReview["ruleSnapshot"];
}

export function recordClaimReview(input: RecordClaimReviewInput, actor: Actor): ClaimReview {
  requireAuthorizedRegulatoryActor(actor, "record a claim review");
  if (!input.notes.trim()) throw new Error("Claim review notes are required.");
  return {
    schemaVersion: "1.0",
    id: newId("claimreview"),
    claimId: input.claimId,
    claimRevision: input.claimRevision,
    formulationId: input.formulationId,
    formulaVersionId: input.formulaVersionId,
    packagingSkuCode: input.packagingSkuCode,
    jurisdiction: input.jurisdiction,
    language: input.language,
    reviewedBy: actor.userId,
    reviewerRole: actor.role,
    reviewedAt: new Date().toISOString(),
    outcome: input.outcome,
    conditions: input.conditions ?? [],
    notes: input.notes,
    evidenceSnapshot: input.evidenceSnapshot ?? [],
    ruleSnapshot: input.ruleSnapshot ?? [],
  };
}

export function revokeClaimReview(reviewId: string, actor: Actor, reason: string): ClaimReviewRevocation {
  requireAuthorizedRegulatoryActor(actor, "revoke a claim review");
  if (!reason.trim()) throw new Error("A reason is required to revoke a claim review.");
  return {
    schemaVersion: "1.0",
    id: newId("claimreviewrevocation"),
    revokesReviewId: reviewId,
    revokedBy: actor.userId,
    revokedByRole: actor.role,
    revokedAt: new Date().toISOString(),
    reason,
  };
}

export function isClaimReviewActive(review: ClaimReview, revocations: ClaimReviewRevocation[], currentClaimRevision: number): boolean {
  if (review.claimRevision !== currentClaimRevision) return false;
  return !revocations.some((r) => r.revokesReviewId === review.id);
}
