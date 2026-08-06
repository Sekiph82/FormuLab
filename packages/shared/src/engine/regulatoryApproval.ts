/**
 * Regulatory blockers for Approval Readiness — spec §2.5/§3.3. Not one of
 * `assessApprovalReadiness`'s own built-in sources (that module's
 * `ApprovalBlockerSource` union is fixed and already covered by 38
 * passing tests this codebase deliberately does not touch) — same
 * one-layer-up pattern already used for the cost-snapshot gate
 * (docs/APPROVAL_WORKFLOW.md#why-cost-is-a-layer-up). Off by default:
 * every flag lives on `ApprovalPolicy` and is only checked when an
 * organization turns it on.
 *
 * Multi-jurisdiction (spec §3.3): the six regulatory gates are evaluated
 * once per resolved jurisdiction (`resolveRegulatoryJurisdictions`), never
 * silently collapsed to "the first market" unless that is exactly what
 * the policy configured. `assessMultiJurisdictionRegulatoryReadiness`
 * aggregates the per-jurisdiction results — ready only when every
 * resolved jurisdiction is ready, and every blocker keeps its own
 * jurisdiction tag so a UI can show exactly which market is blocking.
 */
import { activeEvidenceConfirmations, NON_BLOCKING_FINDING_STATUSES, REGULATORY_JURISDICTIONS } from "../schemas/regulatory";
import type {
  RegulatoryEvidenceConfirmation,
  RegulatoryEvidenceConfirmationRevocation,
  RegulatoryFinding,
  RegulatoryJurisdiction,
  RegulatoryReview,
  RegulatoryReviewEquivalence,
  RegulatoryReviewRevocation,
  RegulatoryRule,
  RegulatoryRuleType,
} from "../schemas/regulatory";
import { explainRegulatoryReviewStatus, findApplicableRegulatoryReview, type RegulatoryReviewStatus } from "./regulatoryReviews";
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
    | "requiredRegulatoryJurisdictions"
    | "requireAllTargetMarketsReviewed"
    | "allowPrimaryMarketOnly"
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
    requiredRegulatoryJurisdictions: policy.requiredRegulatoryJurisdictions,
    requireAllTargetMarketsReviewed: policy.requireAllTargetMarketsReviewed,
    allowPrimaryMarketOnly: policy.allowPrimaryMarketOnly,
  };
}

function isRegulatoryJurisdiction(value: string | undefined): value is RegulatoryJurisdiction {
  return !!value && (REGULATORY_JURISDICTIONS as readonly string[]).includes(value);
}

/**
 * Which jurisdiction(s) the six regulatory gates evaluate against — spec
 * §3.3. Precedence: an explicit `requiredRegulatoryJurisdictions` list
 * always wins; otherwise `requireAllTargetMarketsReviewed` evaluates
 * every one of the formulation's own `targetMarkets`; otherwise (
 * `allowPrimaryMarketOnly`, or nothing configured at all) only the
 * formulation's first target market — the exact behavior this gate had
 * before multi-jurisdiction support existed, so a policy that never
 * touches these three fields keeps working identically.
 */
export function resolveRegulatoryJurisdictions(policy: RegulatoryApprovalPolicy, targetMarkets: string[]): RegulatoryJurisdiction[] {
  if (policy.requiredRegulatoryJurisdictions && policy.requiredRegulatoryJurisdictions.length > 0) {
    return policy.requiredRegulatoryJurisdictions;
  }
  if (policy.requireAllTargetMarketsReviewed) {
    const resolved = targetMarkets.filter(isRegulatoryJurisdiction);
    return resolved.length > 0 ? resolved : ["KE"];
  }
  const primary = targetMarkets[0];
  return [isRegulatoryJurisdiction(primary) ? primary : "KE"];
}

export interface RegulatoryReadinessInput {
  policy: RegulatoryApprovalPolicy;
  jurisdiction: RegulatoryJurisdiction;
  classificationCompleted: boolean;
  hasBlockingFinding: boolean;
  allMandatoryDocumentsPresent: boolean;
  allMandatoryEvidencePresent: boolean;
  allRequiredClaimsReviewed: boolean;
  humanReviewCompleted: boolean;
  /** The full, honest reason `humanReviewCompleted` is what it is —
   *  `"unknown"` when no review was found at all, never silently equal to
   *  `"current"`. */
  humanReviewStatus: RegulatoryReviewStatus;
}

export interface RegulatoryReadinessBlocker {
  id: string;
  code: string;
  message: string;
  jurisdiction: RegulatoryJurisdiction;
}

const HUMAN_REVIEW_BLOCKER_CODE: Partial<Record<RegulatoryReviewStatus, string>> = {
  stale_formula_version: "regulatory_review_wrong_version",
  stale_rule_version: "regulatory_review_stale_rules",
  wrong_packaging_sku: "regulatory_review_wrong_packaging",
};

/** Facts in, blockers out — pure, deterministic, no I/O. Mirrors
 *  `assessApprovalReadiness`'s own lab/stability blocks exactly. */
export function assessRegulatoryReadiness(input: RegulatoryReadinessInput): { ready: boolean; blockers: RegulatoryReadinessBlocker[] } {
  const { policy, jurisdiction } = input;
  const blockers: RegulatoryReadinessBlocker[] = [];
  const push = (code: string, message: string) => blockers.push({ id: `regulatory:${jurisdiction}:${code}`, code, message, jurisdiction });

  if (policy.requireRegulatoryClassificationCompleted && !input.classificationCompleted) {
    push("regulatory_classification_missing", `[${jurisdiction}] This formula has not been run through regulatory classification yet.`);
  }
  if (policy.requireNoBlockingRegulatoryFinding && input.hasBlockingFinding) {
    push("regulatory_blocking_finding", `[${jurisdiction}] At least one regulatory finding is not compliant_with_rule or not_applicable.`);
  }
  if (policy.requireAllMandatoryDocumentsPresent && !input.allMandatoryDocumentsPresent) {
    push("regulatory_documents_missing", `[${jurisdiction}] At least one mandatory regulatory document requirement has no active, confirmed evidence.`);
  }
  if (policy.requireAllMandatoryEvidencePresent && !input.allMandatoryEvidencePresent) {
    push("regulatory_evidence_missing", `[${jurisdiction}] At least one mandatory claim-evidence requirement has no active, confirmed evidence.`);
  }
  if (policy.requireAllRequiredClaimsReviewed && !input.allRequiredClaimsReviewed) {
    push("regulatory_claims_unreviewed", `[${jurisdiction}] At least one claim-restriction finding has not been confirmed reviewed.`);
  }
  if (policy.requireHumanRegulatoryReviewCompleted && !input.humanReviewCompleted) {
    const code = HUMAN_REVIEW_BLOCKER_CODE[input.humanReviewStatus] ?? "regulatory_human_review_missing";
    const detail =
      input.humanReviewStatus === "revoked"
        ? "the recorded review was revoked"
        : input.humanReviewStatus === "superseded"
          ? "the recorded review was superseded by a later one that is not current"
          : input.humanReviewStatus === "stale_formula_version"
            ? "no review is recorded against this exact formula version"
            : input.humanReviewStatus === "stale_rule_version"
              ? "the recorded review used rule versions that have since changed"
              : input.humanReviewStatus === "wrong_packaging_sku"
                ? "the recorded review does not cover this packaging SKU"
                : "no human regulatory review has been recorded for this formula version and jurisdiction";
    push(code, `[${jurisdiction}] Human regulatory review incomplete: ${detail}.`);
  }

  return { ready: blockers.length === 0, blockers };
}

export interface MultiJurisdictionRegulatoryReadiness {
  ready: boolean;
  blockers: RegulatoryReadinessBlocker[];
  jurisdictionsEvaluated: RegulatoryJurisdiction[];
  perJurisdiction: { jurisdiction: RegulatoryJurisdiction; ready: boolean; blockers: RegulatoryReadinessBlocker[] }[];
}

/** Aggregates one `RegulatoryReadinessInput` per resolved jurisdiction.
 *  Ready only when every jurisdiction is ready; an empty jurisdiction
 *  list (a resolution bug, never expected in practice since
 *  `resolveRegulatoryJurisdictions` always returns at least one) is
 *  itself a blocker rather than silently "ready". */
export function assessMultiJurisdictionRegulatoryReadiness(perJurisdiction: RegulatoryReadinessInput[]): MultiJurisdictionRegulatoryReadiness {
  if (perJurisdiction.length === 0) {
    return {
      ready: false,
      blockers: [{ id: "regulatory:none:jurisdiction_missing", code: "regulatory_jurisdiction_missing", message: "No regulatory jurisdiction was resolved for this formulation.", jurisdiction: "KE" }],
      jurisdictionsEvaluated: [],
      perJurisdiction: [],
    };
  }
  const results = perJurisdiction.map((input) => ({ jurisdiction: input.jurisdiction, ...assessRegulatoryReadiness(input) }));
  return {
    ready: results.every((r) => r.ready),
    blockers: results.flatMap((r) => r.blockers),
    jurisdictionsEvaluated: perJurisdiction.map((p) => p.jurisdiction),
    perJurisdiction: results,
  };
}

function findingsForRuleType(findings: RegulatoryFinding[], rules: RegulatoryRule[], type: RegulatoryRuleType): RegulatoryFinding[] {
  const ruleIds = new Set(rules.filter((r) => r.ruleType === type).map((r) => r.id));
  return findings.filter((f) => ruleIds.has(f.ruleId));
}

export interface DeriveRegulatoryReadinessInput {
  policy: RegulatoryApprovalPolicy;
  classified: boolean;
  /** Every finding across every jurisdiction — filtered to `jurisdiction`
   *  internally, so a caller can pass one combined evaluation result for
   *  a multi-jurisdiction pass. */
  findings: RegulatoryFinding[];
  rules: RegulatoryRule[];
  reviews: RegulatoryReview[];
  reviewRevocations: RegulatoryReviewRevocation[];
  reviewEquivalences: RegulatoryReviewEquivalence[];
  confirmations: RegulatoryEvidenceConfirmation[];
  confirmationRevocations: RegulatoryEvidenceConfirmationRevocation[];
  /** Must be a real, saved `FormulationVersion.id` — never
   *  `"working_draft"`. A caller with only a working draft (no saved
   *  version yet) should not call this at all; there is nothing a human
   *  regulatory review could bind to yet. */
  formulaVersionId: string;
  jurisdiction: RegulatoryJurisdiction;
  packagingSkuCode?: string;
}

/**
 * Turns real, persisted regulatory records into the plain facts
 * `assessRegulatoryReadiness` consumes — never a manually supplied
 * placeholder, and never a transient UI checkbox. "Mandatory documents
 * present" / "mandatory evidence present" / "required claims reviewed"
 * are each derived from an active (non-revoked)
 * `RegulatoryEvidenceConfirmation` matching the finding's own `ruleId`,
 * for this exact formula version/jurisdiction/packaging SKU — a
 * `document_requirement`/`claim_evidence_requirement`/`claim_restriction`
 * finding with no matching `confirmed`/`not_applicable` confirmation
 * blocks, regardless of what a UI checkbox showed in a previous session.
 * "Human review completed" comes from `findApplicableRegulatoryReview`,
 * which itself refuses to treat a wrong-version/wrong-jurisdiction/
 * wrong-packaging/revoked/superseded/stale-rule review as satisfying
 * anything. See docs/REGULATORY_ENGINE.md.
 */
export function deriveRegulatoryReadiness(input: DeriveRegulatoryReadinessInput): RegulatoryReadinessInput {
  const relevantFindings = input.findings.filter((f) => f.jurisdiction === input.jurisdiction);
  const activeConfirmations = activeEvidenceConfirmations(
    input.formulaVersionId,
    input.jurisdiction,
    input.packagingSkuCode,
    input.confirmations,
    input.confirmationRevocations,
  );

  const isConfirmedSatisfied = (ruleId: string): boolean => {
    const matches = activeConfirmations.filter((c) => c.ruleId === ruleId);
    if (matches.length === 0) return false;
    const latest = matches.reduce((a, b) => (a.confirmedAt > b.confirmedAt ? a : b));
    return latest.status === "confirmed" || latest.status === "not_applicable";
  };

  const documentFindings = findingsForRuleType(relevantFindings, input.rules, "document_requirement");
  const evidenceFindings = findingsForRuleType(relevantFindings, input.rules, "claim_evidence_requirement");
  const claimFindings = findingsForRuleType(relevantFindings, input.rules, "claim_restriction");

  const reviewCtx = { formulaVersionId: input.formulaVersionId, jurisdiction: input.jurisdiction, packagingSkuCode: input.packagingSkuCode };
  const applicableReview = findApplicableRegulatoryReview(reviewCtx, input.reviews, input.reviewRevocations, input.reviewEquivalences, input.rules);
  const humanReviewStatus = applicableReview ? "current" : explainRegulatoryReviewStatus(reviewCtx, input.reviews, input.reviewRevocations, input.rules);

  return {
    policy: input.policy,
    jurisdiction: input.jurisdiction,
    classificationCompleted: input.classified,
    hasBlockingFinding: relevantFindings.some((f) => !NON_BLOCKING_FINDING_STATUSES.includes(f.status)),
    allMandatoryDocumentsPresent: documentFindings.every((f) => isConfirmedSatisfied(f.ruleId)),
    allMandatoryEvidencePresent: evidenceFindings.every((f) => isConfirmedSatisfied(f.ruleId)),
    allRequiredClaimsReviewed: claimFindings.every((f) => isConfirmedSatisfied(f.ruleId)),
    humanReviewCompleted: !!applicableReview,
    humanReviewStatus,
  };
}
