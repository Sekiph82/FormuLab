/**
 * Phase 3 §10 — dossier readiness folded into Approval Readiness, same
 * one-layer-up pattern `engine/regulatoryApproval.ts` already uses for
 * the six Phase 2 regulatory gates: none of this is part of
 * `assessApprovalReadiness`'s own fixed blocker-source union, every gate
 * is off by default, and installing Phase 3 must never block a project
 * that never opts in.
 */
import type { ApprovalPolicy } from "../schemas/approvalPolicy";
import type { RegulatoryDossier, RegulatoryDossierEvidenceItem, RegulatoryDossierRequirement, RegulatoryDossierReview, RegulatoryDossierReviewRevocation, RegulatoryRequirementEvidenceLink } from "../schemas/dossier";
import type { RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";
import { buildEvidenceMatrix, calculateDossierReadiness, compareDossierRequirementsToCurrentRules, currentRequirementsForRevision, deriveDossierStatus, isDossierReviewActive } from "./regulatoryDossier";

export type DossierApprovalPolicy = Partial<
  Pick<
    ApprovalPolicy,
    | "requireRegulatoryDossier"
    | "requireDossierReadyForReview"
    | "requireDossierReviewComplete"
    | "requireNoMissingMandatoryDossierEvidence"
    | "requireNoExpiredMandatoryDossierEvidence"
    | "requireAllRequiredJurisdictionDossiers"
  >
>;

export function toDossierApprovalPolicy(policy: ApprovalPolicy): DossierApprovalPolicy {
  return {
    requireRegulatoryDossier: policy.requireRegulatoryDossier,
    requireDossierReadyForReview: policy.requireDossierReadyForReview,
    requireDossierReviewComplete: policy.requireDossierReviewComplete,
    requireNoMissingMandatoryDossierEvidence: policy.requireNoMissingMandatoryDossierEvidence,
    requireNoExpiredMandatoryDossierEvidence: policy.requireNoExpiredMandatoryDossierEvidence,
    requireAllRequiredJurisdictionDossiers: policy.requireAllRequiredJurisdictionDossiers,
  };
}

/** Which jurisdictions the dossier gate checks — `requireAllRequiredJurisdictionDossiers`
 *  expands the check to every one of the formulation's own `targetMarkets`;
 *  otherwise only the primary (first) target market, matching the same
 *  "primary market only unless told otherwise" default the Phase 2
 *  regulatory gates use. */
export function resolveDossierJurisdictions(policy: DossierApprovalPolicy, targetMarkets: RegulatoryJurisdiction[]): RegulatoryJurisdiction[] {
  if (targetMarkets.length === 0) return [];
  if (policy.requireAllRequiredJurisdictionDossiers) return targetMarkets;
  return [targetMarkets[0]];
}

export interface DossierApprovalBlocker {
  id: string;
  code: string;
  message: string;
  jurisdiction: RegulatoryJurisdiction;
}

export type DossierScopeMatchReason = "matched" | "no_dossier" | "jurisdiction_not_covered" | "wrong_formula_version" | "wrong_packaging_sku";

/** Finds the one active (non-superseded/archived/withdrawn) dossier that
 *  actually covers this exact formula version + packaging SKU +
 *  jurisdiction — never a dossier for a different version/SKU, even if
 *  it covers the right jurisdiction. Mirrors
 *  `findApplicableRegulatoryReview`'s "no pre-filtering, compute the
 *  specific reason" shape. */
export function findDossierForScope(
  dossiers: RegulatoryDossier[],
  ctx: { formulaVersionId: string; packagingSkuCode?: string; jurisdiction: RegulatoryJurisdiction },
): { dossier?: RegulatoryDossier; reason: DossierScopeMatchReason } {
  const active = dossiers.filter((d) => {
    const effective = deriveDossierStatus(d, dossiers);
    return effective !== "superseded" && effective !== "archived" && effective !== "withdrawn";
  });
  if (active.length === 0) return { reason: "no_dossier" };

  const coveringJurisdiction = active.filter((d) => d.jurisdictions.includes(ctx.jurisdiction));
  if (coveringJurisdiction.length === 0) return { reason: "jurisdiction_not_covered" };

  const rightVersion = coveringJurisdiction.filter((d) => d.formulaVersionId === ctx.formulaVersionId);
  if (rightVersion.length === 0) return { reason: "wrong_formula_version" };

  const rightSku = rightVersion.filter((d) => !ctx.packagingSkuCode || !d.packagingSkuCode || d.packagingSkuCode === ctx.packagingSkuCode);
  if (rightSku.length === 0) return { reason: "wrong_packaging_sku" };

  const dossier = [...rightSku].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return { dossier, reason: "matched" };
}

export interface DeriveDossierApprovalReadinessInput {
  policy: DossierApprovalPolicy;
  formulaVersionId: string;
  packagingSkuCode?: string;
  jurisdictions: RegulatoryJurisdiction[];
  dossiers: RegulatoryDossier[];
  requirements: RegulatoryDossierRequirement[];
  links: RegulatoryRequirementEvidenceLink[];
  evidenceItems: RegulatoryDossierEvidenceItem[];
  reviews: RegulatoryDossierReview[];
  reviewRevocations: RegulatoryDossierReviewRevocation[];
  /** Optional — when supplied, a frozen requirement set that has drifted
   *  from the currently active rules produces a `dossier_requirement_stale`
   *  warning-grade blocker under `requireDossierReadyForReview`. */
  currentRules?: RegulatoryRule[];
}

/** Facts in, blockers out — one call per resolved jurisdiction, folded
 *  together by the caller the same way `assessMultiJurisdictionRegulatoryReadiness`
 *  folds the six Phase 2 regulatory gates. */
export function deriveDossierApprovalReadiness(input: DeriveDossierApprovalReadinessInput): { ready: boolean; blockers: DossierApprovalBlocker[] } {
  const { policy } = input;
  if (!policy.requireRegulatoryDossier) return { ready: true, blockers: [] };

  const blockers: DossierApprovalBlocker[] = [];
  for (const jurisdiction of input.jurisdictions) {
    const push = (code: string, message: string) => blockers.push({ id: `dossier:${jurisdiction}:${code}`, code, message, jurisdiction });
    const { dossier, reason } = findDossierForScope(input.dossiers, { formulaVersionId: input.formulaVersionId, packagingSkuCode: input.packagingSkuCode, jurisdiction });

    if (reason !== "matched" || !dossier) {
      const code =
        reason === "wrong_formula_version"
          ? "dossier_wrong_formula_version"
          : reason === "wrong_packaging_sku"
            ? "dossier_wrong_packaging_sku"
            : reason === "jurisdiction_not_covered"
              ? "dossier_jurisdiction_missing"
              : "dossier_missing";
      push(code, `[${jurisdiction}] No regulatory dossier covers this exact formula version/packaging SKU/jurisdiction (${reason}).`);
      continue;
    }

    const requirementsForRevision = currentRequirementsForRevision(input.requirements, dossier.id, dossier.revision);
    const matrix = buildEvidenceMatrix(requirementsForRevision, input.links, input.evidenceItems, dossier.formulaVersionId, dossier.packagingSkuCode);
    const readiness = calculateDossierReadiness(dossier, matrix);

    if (policy.requireDossierReadyForReview) {
      if (readiness.overallReadiness === "not_ready" || readiness.overallReadiness === "partially_ready" || readiness.overallReadiness === "unknown") {
        push("dossier_not_ready", `[${jurisdiction}] Dossier ${dossier.dossierCode} is not ready for review (${readiness.overallReadiness}).`);
      }
      if (input.currentRules) {
        const drift = compareDossierRequirementsToCurrentRules(requirementsForRevision, { jurisdictions: [jurisdiction], productFamilyCode: dossier.productFamilyCode, rules: input.currentRules, findings: [] });
        const hasDrift = drift.newRequirementCodes.length > 0 || drift.removedRequirementCodes.length > 0 || drift.changedRuleVersionCodes.length > 0 || drift.changedMandatoryStatusCodes.length > 0;
        if (hasDrift) push("dossier_requirement_stale", `[${jurisdiction}] Dossier ${dossier.dossierCode}'s frozen requirements have drifted from the currently active rule set.`);
      }
    }

    if (policy.requireDossierReviewComplete) {
      const activeApproved = input.reviews.some(
        (r) => r.dossierId === dossier.id && isDossierReviewActive(r, input.reviewRevocations, dossier.revision) && (r.outcome === "approved" || r.outcome === "approved_with_conditions"),
      );
      if (!activeApproved) push("dossier_review_incomplete", `[${jurisdiction}] Dossier ${dossier.dossierCode} has no active, approved review for its current revision.`);
    }

    if (policy.requireNoMissingMandatoryDossierEvidence) {
      if (readiness.missingMandatoryRequirements > 0) push("dossier_mandatory_evidence_missing", `[${jurisdiction}] Dossier ${dossier.dossierCode} is missing ${readiness.missingMandatoryRequirements} mandatory requirement(s)' evidence.`);
      if (readiness.rejectedEvidenceCount > 0) push("dossier_evidence_rejected", `[${jurisdiction}] Dossier ${dossier.dossierCode} has ${readiness.rejectedEvidenceCount} rejected evidence item(s) blocking a requirement.`);
    }

    if (policy.requireNoExpiredMandatoryDossierEvidence && readiness.expiredEvidenceCount > 0) {
      push("dossier_evidence_expired", `[${jurisdiction}] Dossier ${dossier.dossierCode} has ${readiness.expiredEvidenceCount} expired evidence item(s).`);
    }
  }

  return { ready: blockers.length === 0, blockers };
}
