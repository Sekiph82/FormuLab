/**
 * Regulatory blockers for Approval Readiness — spec §2.5. Not one of
 * `assessApprovalReadiness`'s own built-in sources (that module's
 * `ApprovalBlockerSource` union is fixed and already covered by 38
 * passing tests this codebase deliberately does not touch) — same
 * one-layer-up pattern already used for the cost-snapshot gate
 * (docs/APPROVAL_WORKFLOW.md#why-cost-is-a-layer-up). Off by default:
 * every flag lives on `ApprovalPolicy` and is only checked when an
 * organization turns it on.
 */
import { NON_BLOCKING_FINDING_STATUSES } from "../schemas/regulatory";
import type { RegulatoryFinding, RegulatoryJurisdiction, RegulatoryReview, RegulatoryRule, RegulatoryRuleType } from "../schemas/regulatory";
import type { ApprovalPolicy } from "../schemas/approvalPolicy";

export type RegulatoryApprovalPolicy = Partial<
  Pick<
    ApprovalPolicy,
    | "requireRegulatoryClassificationCompleted"
    | "requireNoBlockingRegulatoryFinding"
    | "requireAllMandatoryDocumentsPresent"
    | "requireAllMandatoryEvidencePresent"
    | "requireAllRequiredClaimsReviewed"
    | "requireHumanRegulatoryReviewCompleted"
  >
>;

export function toRegulatoryApprovalPolicy(policy: ApprovalPolicy): RegulatoryApprovalPolicy {
  return {
    requireRegulatoryClassificationCompleted: policy.requireRegulatoryClassificationCompleted,
    requireNoBlockingRegulatoryFinding: policy.requireNoBlockingRegulatoryFinding,
    requireAllMandatoryDocumentsPresent: policy.requireAllMandatoryDocumentsPresent,
    requireAllMandatoryEvidencePresent: policy.requireAllMandatoryEvidencePresent,
    requireAllRequiredClaimsReviewed: policy.requireAllRequiredClaimsReviewed,
    requireHumanRegulatoryReviewCompleted: policy.requireHumanRegulatoryReviewCompleted,
  };
}

export interface RegulatoryReadinessInput {
  policy: RegulatoryApprovalPolicy;
  classificationCompleted: boolean;
  hasBlockingFinding: boolean;
  allMandatoryDocumentsPresent: boolean;
  allMandatoryEvidencePresent: boolean;
  allRequiredClaimsReviewed: boolean;
  humanReviewCompleted: boolean;
}

export interface RegulatoryReadinessBlocker {
  id: string;
  code: string;
  message: string;
}

/** Facts in, blockers out — pure, deterministic, no I/O. Mirrors
 *  `assessApprovalReadiness`'s own lab/stability blocks exactly. */
export function assessRegulatoryReadiness(input: RegulatoryReadinessInput): { ready: boolean; blockers: RegulatoryReadinessBlocker[] } {
  const { policy } = input;
  const blockers: RegulatoryReadinessBlocker[] = [];

  if (policy.requireRegulatoryClassificationCompleted && !input.classificationCompleted) {
    blockers.push({
      id: "regulatory:classification_missing",
      code: "regulatory_classification_missing",
      message: "This formula has not been run through regulatory classification yet.",
    });
  }
  if (policy.requireNoBlockingRegulatoryFinding && input.hasBlockingFinding) {
    blockers.push({
      id: "regulatory:finding_blocking",
      code: "regulatory_finding_blocking",
      message: "At least one regulatory finding is not compliant_with_rule or not_applicable.",
    });
  }
  if (policy.requireAllMandatoryDocumentsPresent && !input.allMandatoryDocumentsPresent) {
    blockers.push({
      id: "regulatory:documents_missing",
      code: "regulatory_documents_missing",
      message: "At least one mandatory regulatory document requirement is not yet satisfied.",
    });
  }
  if (policy.requireAllMandatoryEvidencePresent && !input.allMandatoryEvidencePresent) {
    blockers.push({
      id: "regulatory:evidence_missing",
      code: "regulatory_evidence_missing",
      message: "At least one mandatory claim-evidence requirement is not yet satisfied.",
    });
  }
  if (policy.requireAllRequiredClaimsReviewed && !input.allRequiredClaimsReviewed) {
    blockers.push({
      id: "regulatory:claims_not_reviewed",
      code: "regulatory_claims_not_reviewed",
      message: "At least one claim-restriction finding has not been cleared.",
    });
  }
  if (policy.requireHumanRegulatoryReviewCompleted && !input.humanReviewCompleted) {
    blockers.push({
      id: "regulatory:human_review_incomplete",
      code: "regulatory_human_review_incomplete",
      message: "No human regulatory review has been recorded for this formula version and jurisdiction.",
    });
  }

  return { ready: blockers.length === 0, blockers };
}

function findingsForRuleType(findings: RegulatoryFinding[], rules: RegulatoryRule[], type: RegulatoryRuleType): RegulatoryFinding[] {
  const ruleIds = new Set(rules.filter((r) => r.ruleType === type).map((r) => r.id));
  return findings.filter((f) => ruleIds.has(f.ruleId));
}

function allNonBlocking(findings: RegulatoryFinding[]): boolean {
  return findings.every((f) => NON_BLOCKING_FINDING_STATUSES.includes(f.status));
}

export interface DeriveRegulatoryReadinessInput {
  policy: RegulatoryApprovalPolicy;
  classified: boolean;
  findings: RegulatoryFinding[];
  rules: RegulatoryRule[];
  reviews: RegulatoryReview[];
  versionId: string;
  jurisdiction: RegulatoryJurisdiction;
}

/**
 * Turns real, persisted regulatory records into the plain facts
 * `assessRegulatoryReadiness` consumes — never a manually supplied
 * placeholder. "Mandatory documents present"/"mandatory evidence
 * present"/"required claims reviewed" are read from the real
 * `document_requirement`/`claim_evidence_requirement`/`claim_restriction`
 * findings respectively (all non-blocking = satisfied) rather than a
 * hand-set boolean — there is no dossier/evidence-tracking UI yet
 * (Phase 3's job), so a `document_requirement`/`claim_evidence_requirement`
 * rule stays `missing_data` (blocking) until a human explicitly confirms
 * it via `manuallyConfirmedRuleIds`/`providedEvidenceTypes` in
 * `evaluateRegulatory`'s context — see docs/REGULATORY_ENGINE.md.
 */
export function deriveRegulatoryReadiness(input: DeriveRegulatoryReadinessInput): RegulatoryReadinessInput {
  const relevantFindings = input.findings.filter((f) => f.jurisdiction === input.jurisdiction);
  return {
    policy: input.policy,
    classificationCompleted: input.classified,
    hasBlockingFinding: relevantFindings.some((f) => !NON_BLOCKING_FINDING_STATUSES.includes(f.status)),
    allMandatoryDocumentsPresent: allNonBlocking(findingsForRuleType(relevantFindings, input.rules, "document_requirement")),
    allMandatoryEvidencePresent: allNonBlocking(findingsForRuleType(relevantFindings, input.rules, "claim_evidence_requirement")),
    allRequiredClaimsReviewed: allNonBlocking(findingsForRuleType(relevantFindings, input.rules, "claim_restriction")),
    humanReviewCompleted: input.reviews.some((r) => r.versionId === input.versionId && r.jurisdiction === input.jurisdiction),
  };
}
