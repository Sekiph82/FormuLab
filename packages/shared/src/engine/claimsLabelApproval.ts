/**
 * Phase 4 §17 — claims & label readiness folded into Approval Readiness,
 * same one-layer-up pattern `engine/regulatoryDossierApproval.ts` already
 * uses for the Phase 3 dossier gates: none of this is part of
 * `assessApprovalReadiness`'s own fixed blocker-source union, every gate is
 * off by default, and installing Phase 4 must never block a project that
 * never opts in.
 *
 * The 19 structured blocker codes below are this session's own coherent,
 * documented design (the originating instruction named "19 structured
 * blocker codes" without the exact list surviving into this context) — one
 * to three codes per opt-in policy field, grouped claims-first then
 * labels-first, deliberately mirroring the dossier gate's
 * one-code-per-failure-reason shape:
 *   requireAllClaimsReviewed            -> claims_missing_review, claims_review_stale
 *   requireNoProhibitedClaims           -> claims_prohibited_present
 *   requireNoUnsupportedClaims          -> claims_unsupported_present, claims_high_risk_unreviewed, claims_evidence_missing
 *   requireLabelReviewComplete          -> label_missing, label_review_incomplete, label_review_stale
 *   requireArtworkApproved              -> label_artwork_missing, label_artwork_not_approved
 *   requireFormulaLabelConsistency      -> label_wrong_formula_version, label_wrong_packaging_sku, label_ingredient_declaration_incomplete, label_claim_inconsistent
 *   requireAllRequiredLanguagesReviewed -> label_language_missing, label_language_review_incomplete
 *   (cross-cutting, always checked once either claims or label gates are on) -> label_content_missing, label_human_review_required
 */
import type { ApprovalPolicy } from "../schemas/approvalPolicy";
import type { RegulatoryDossierEvidenceItem } from "../schemas/dossier";
import type { RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";
import type {
  ClaimEvidenceLink,
  ClaimReview,
  ClaimReviewRevocation,
  LabelArtwork,
  LabelContentBlock,
  LabelReview,
  LabelReviewRevocation,
  ProductClaim,
  ProductLabel,
} from "../schemas/claimsLabels";
import { deriveClaimEffectiveStatus, evaluateClaimEvidence, isClaimReviewActive } from "./claims";
import {
  currentContentForRevision,
  deriveArtworkEffectiveStatus,
  deriveLabelEffectiveStatus,
  evaluateFormulaLabelConsistency,
  evaluateLabelContent,
  isLabelReviewActive,
  resolveLabelRequirements,
} from "./labels";
import type { FormulationVersion } from "../schemas/formulation";

export type ClaimsLabelApprovalPolicy = Partial<
  Pick<
    ApprovalPolicy,
    | "requireAllClaimsReviewed"
    | "requireNoProhibitedClaims"
    | "requireNoUnsupportedClaims"
    | "requireLabelReviewComplete"
    | "requireArtworkApproved"
    | "requireFormulaLabelConsistency"
    | "requireAllRequiredLanguagesReviewed"
  >
>;

export function toClaimsLabelApprovalPolicy(policy: ApprovalPolicy): ClaimsLabelApprovalPolicy {
  return {
    requireAllClaimsReviewed: policy.requireAllClaimsReviewed,
    requireNoProhibitedClaims: policy.requireNoProhibitedClaims,
    requireNoUnsupportedClaims: policy.requireNoUnsupportedClaims,
    requireLabelReviewComplete: policy.requireLabelReviewComplete,
    requireArtworkApproved: policy.requireArtworkApproved,
    requireFormulaLabelConsistency: policy.requireFormulaLabelConsistency,
    requireAllRequiredLanguagesReviewed: policy.requireAllRequiredLanguagesReviewed,
  };
}

function anyClaimsGateOn(policy: ClaimsLabelApprovalPolicy): boolean {
  return !!(policy.requireAllClaimsReviewed || policy.requireNoProhibitedClaims || policy.requireNoUnsupportedClaims);
}
function anyLabelGateOn(policy: ClaimsLabelApprovalPolicy): boolean {
  return !!(policy.requireLabelReviewComplete || policy.requireArtworkApproved || policy.requireFormulaLabelConsistency || policy.requireAllRequiredLanguagesReviewed);
}

export interface ClaimsLabelApprovalBlocker {
  id: string;
  code: string;
  message: string;
}

export interface DeriveClaimsLabelApprovalReadinessInput {
  policy: ClaimsLabelApprovalPolicy;
  formulationName: string;
  formulaVersion: Pick<FormulationVersion, "id" | "lines">;
  packagingSkuCode?: string;
  jurisdictions: RegulatoryJurisdiction[];
  requiredLanguages: string[];
  claims: ProductClaim[];
  claimLinks: ClaimEvidenceLink[];
  claimReviews: ClaimReview[];
  claimReviewRevocations: ClaimReviewRevocation[];
  dossierEvidence: RegulatoryDossierEvidenceItem[];
  labels: ProductLabel[];
  labelContent: LabelContentBlock[];
  labelArtworks: LabelArtwork[];
  labelReviews: LabelReview[];
  labelReviewRevocations: LabelReviewRevocation[];
  rules: RegulatoryRule[];
}

/** Facts in, blockers out — evaluated once for the given formula version
 *  scope (never crossing a formula version or packaging SKU silently: every
 *  claim/label considered here is pre-filtered by the caller to this exact
 *  `formulaVersion.id`/`packagingSkuCode`). */
export function deriveClaimsLabelApprovalReadiness(input: DeriveClaimsLabelApprovalReadinessInput): { ready: boolean; blockers: ClaimsLabelApprovalBlocker[] } {
  const { policy } = input;
  if (!anyClaimsGateOn(policy) && !anyLabelGateOn(policy)) return { ready: true, blockers: [] };

  const blockers: ClaimsLabelApprovalBlocker[] = [];
  const push = (code: string, message: string) => blockers.push({ id: `claimslabel:${code}:${blockers.length}`, code, message });

  // A claim is scoped to an exact formula version (unlike a label, whose
  // formulaVersionId mismatch is itself a detectable consistency finding) —
  // a claim recorded against a different version must never silently gate
  // approval of this one, so effective-status is computed against the
  // claim's own full lineage (never cross-version) but the active set itself
  // is filtered to this exact version first.
  const activeClaims = input.claims
    .filter((c) => c.formulaVersionId === input.formulaVersion.id)
    .filter((c) => {
      const effective = deriveClaimEffectiveStatus(c, input.claims);
      return effective !== "superseded" && effective !== "withdrawn" && effective !== "rejected";
    });

  if (anyClaimsGateOn(policy)) {
    for (const claim of activeClaims) {
      const evidenceState = evaluateClaimEvidence(claim, input.claimLinks, input.dossierEvidence, {
        formulaVersionId: input.formulaVersion.id,
        packagingSkuCode: input.packagingSkuCode,
        jurisdictions: claim.jurisdictions,
      });

      if (policy.requireAllClaimsReviewed) {
        const hasActiveReview = input.claimReviews.some((r) => r.claimId === claim.id && isClaimReviewActive(r, input.claimReviewRevocations, 1));
        if (!hasActiveReview) push("claims_missing_review", `Claim "${claim.claimText}" (${claim.claimCode}) has no active recorded review.`);
        else {
          const latestReview = input.claimReviews.filter((r) => r.claimId === claim.id).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0];
          if (latestReview && new Date(claim.updatedAt) > new Date(latestReview.reviewedAt)) {
            push("claims_review_stale", `Claim "${claim.claimText}" (${claim.claimCode}) was updated after its most recent review — the review no longer covers the current claim.`);
          }
        }
      }

      if (policy.requireNoProhibitedClaims && claim.status === "prohibited") {
        push("claims_prohibited_present", `Claim "${claim.claimText}" (${claim.claimCode}) is prohibited and still active in this scope.`);
      }

      if (policy.requireNoUnsupportedClaims) {
        if (claim.status !== "supported" && claim.status !== "supported_with_conditions" && claim.status !== "prohibited") {
          push("claims_unsupported_present", `Claim "${claim.claimText}" (${claim.claimCode}) is not yet supported (${claim.status}).`);
        }
        if (evidenceState.missingEvidence) push("claims_evidence_missing", `Claim "${claim.claimText}" (${claim.claimCode}) has no accepted evidence link.`);
      }
    }
  }

  if (anyLabelGateOn(policy)) {
    for (const jurisdiction of input.jurisdictions) {
      for (const language of input.requiredLanguages) {
        // Never filter by formulaVersionId here: a label whose OWN
        // formulaVersionId silently points at a different version than the
        // one being approved is exactly what `requireFormulaLabelConsistency`
        // must catch as a blocking `label_wrong_formula_version` finding
        // below — filtering it out here would hide that mismatch instead.
        const candidateLabels = input.labels.filter((l) => l.jurisdiction === jurisdiction && l.language === language && (!input.packagingSkuCode || !l.packagingSkuCode || l.packagingSkuCode === input.packagingSkuCode));
        const label = candidateLabels.filter((l) => deriveLabelEffectiveStatus(l, input.labels) !== "superseded").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

        if (!label) {
          push("label_missing", `[${jurisdiction}/${language}] No product label covers this exact formula version/packaging SKU/jurisdiction/language.`);
          push("label_language_missing", `[${jurisdiction}/${language}] Required language "${language}" has no covering label.`);
          continue;
        }

        const blocks = currentContentForRevision(input.labelContent, label.id, label.revision);
        const artworksForLabel = input.labelArtworks.filter((a) => a.labelId === label.id && a.labelRevision === label.revision);
        const currentArtwork = artworksForLabel.find((a) => deriveArtworkEffectiveStatus(a, artworksForLabel) !== "superseded");
        const hasActiveClaims = activeClaims.some((c) => c.formulaVersionId === input.formulaVersion.id && c.jurisdictions.includes(jurisdiction));
        const requirements = resolveLabelRequirements({ jurisdiction, language, rules: input.rules, hasActiveClaims });
        const contentRows = evaluateLabelContent(requirements, blocks, language);

        if (policy.requireLabelReviewComplete) {
          const activeReview = input.labelReviews.find(
            (r) => r.labelId === label.id && isLabelReviewActive(r, input.labelReviewRevocations, label.revision, r.artworkRevision) && (r.outcome === "approved" || r.outcome === "approved_with_conditions"),
          );
          if (!activeReview) push("label_review_incomplete", `[${jurisdiction}/${language}] Label ${label.labelCode} has no active, approved review for its current revision.`);
          const anyReviewForRevision = input.labelReviews.some((r) => r.labelId === label.id && r.labelRevision === label.revision);
          if (anyReviewForRevision && !activeReview) push("label_review_stale", `[${jurisdiction}/${language}] Label ${label.labelCode}'s prior review no longer covers its current label/artwork revision.`);
        }

        if (policy.requireArtworkApproved) {
          if (!currentArtwork) push("label_artwork_missing", `[${jurisdiction}/${language}] Label ${label.labelCode} has no artwork uploaded.`);
          else if (currentArtwork.status !== "approved") push("label_artwork_not_approved", `[${jurisdiction}/${language}] Label ${label.labelCode}'s artwork ${currentArtwork.artworkCode} is ${currentArtwork.status}, not approved.`);
        }

        if (policy.requireFormulaLabelConsistency) {
          const consistencyFindings = evaluateFormulaLabelConsistency({ formulationName: input.formulationName, formulaVersion: input.formulaVersion, label, packagingSkuCode: input.packagingSkuCode }, blocks);
          for (const finding of consistencyFindings) {
            const code = finding.code === "wrong_formula_version" ? "label_wrong_formula_version" : finding.code === "wrong_packaging_sku" ? "label_wrong_packaging_sku" : finding.code === "ingredient_declaration_incomplete" ? "label_ingredient_declaration_incomplete" : "label_claim_inconsistent";
            if (finding.severity === "blocking") push(code, `[${jurisdiction}/${language}] ${finding.message}`);
          }
        }

        if (policy.requireAllRequiredLanguagesReviewed) {
          const activeReview = input.labelReviews.find((r) => r.labelId === label.id && isLabelReviewActive(r, input.labelReviewRevocations, label.revision, r.artworkRevision) && (r.outcome === "approved" || r.outcome === "approved_with_conditions"));
          if (!activeReview) push("label_language_review_incomplete", `[${jurisdiction}/${language}] Required language "${language}" has no active, approved label review.`);
        }

        const missingMandatory = contentRows.filter((r) => r.requirement.mandatory && r.state === "missing");
        if (missingMandatory.length > 0) push("label_content_missing", `[${jurisdiction}/${language}] Label ${label.labelCode} is missing ${missingMandatory.length} mandatory content block(s).`);
        const humanReviewRows = contentRows.filter((r) => r.state === "human_review_required");
        if (humanReviewRows.length > 0) push("label_human_review_required", `[${jurisdiction}/${language}] Label ${label.labelCode} has ${humanReviewRows.length} content block(s) requiring human review.`);
      }
    }

    if (policy.requireNoUnsupportedClaims) {
      const highRisk = activeClaims.filter((c) => (["medical", "therapeutic", "antibacterial", "antimicrobial", "disinfectant", "germ_kill"] as const).includes(c.claimCategory as never) && c.status !== "supported" && c.status !== "supported_with_conditions" && c.status !== "prohibited");
      for (const claim of highRisk) push("claims_high_risk_unreviewed", `Claim "${claim.claimText}" (${claim.claimCode}) is a high-risk category (${claim.claimCategory}) awaiting formal review.`);
    }
  }

  return { ready: blockers.length === 0, blockers };
}
