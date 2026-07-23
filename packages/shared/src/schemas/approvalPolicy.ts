/**
 * A persisted, per-organization approval policy: which laboratory/stability
 * gates apply before a version may be granted `pilot_approved` or
 * `production_approved`, for which product families and packaging SKUs.
 *
 * This is the durable counterpart to the per-call `LabApprovalPolicy`/
 * `StabilityApprovalPolicy` objects in `engine/approvalReadiness.ts` — that
 * module still never reads a policy record itself; a caller resolves the
 * applicable `ApprovalPolicy` record(s) for a version, converts them with
 * `toLabApprovalPolicy`/`toStabilityApprovalPolicy` below, and passes the
 * result in, exactly as before. Nothing here hardcodes a duration or a
 * count — `minimumRequiredTimePoints` is the organization's own number.
 */
import { z } from "zod";
import type { LabApprovalPolicy, StabilityApprovalPolicy } from "../engine/approvalReadiness";
import { REGULATORY_JURISDICTIONS } from "./regulatory";

export const APPROVAL_POLICY_TARGET_STATUSES = ["pilot_approved", "production_approved"] as const;
export type ApprovalPolicyTargetStatus = (typeof APPROVAL_POLICY_TARGET_STATUSES)[number];

export const approvalPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Empty means "applies to every product family" / "every packaging SKU"
   *  — the same unrestricted-when-empty convention `TestDefinition`'s own
   *  applicability arrays use. */
  productFamilyCodes: z.array(z.string()).default([]),
  packagingSkuCodes: z.array(z.string()).default([]),
  targetStatus: z.enum(APPROVAL_POLICY_TARGET_STATUSES),
  effectiveDate: z.string().optional(),
  verificationStatus: z.enum(["verified", "not_verified"]).default("not_verified"),
  /** Seeded example policies ship `false` — turning one on is a deliberate
   *  organizational act, never a side effect of installing FormuLab. */
  active: z.boolean().default(false),
  /** Terminal — distinct from a merely inactive policy. A retired policy
   *  cannot be reactivated; clone it or restore an old revision instead.
   *  See `engine/approvalPolicy.ts`. */
  retired: z.boolean().default(false),
  /** Bumped by every edit/activate/deactivate/retire/restore — see
   *  `ApprovalPolicyRevision` below, which is what actually preserves the
   *  history this number counts. */
  revisionNumber: z.number().int().positive().default(1),
  /** Explicit organization-set tie-break when two policies of otherwise
   *  equal specificity match the same version — see
   *  `resolvePolicyPrecedence`. Higher wins. Optional: most deployments
   *  never need it because scope specificity alone resolves the match. */
  priority: z.number().optional(),

  requireCompletedTrial: z.boolean().default(false),
  requireAllRequiredTestsCompleted: z.boolean().default(false),
  requireAllCriticalTestsPassed: z.boolean().default(false),
  requireNoUnresolvedCriticalDeviation: z.boolean().default(false),
  requireNoUnresolvedCriticalCorrectiveAction: z.boolean().default(false),

  requireActiveStudy: z.boolean().default(false),
  requireInitialTestsPassed: z.boolean().default(false),
  minimumRequiredTimePoints: z.number().int().nonnegative().optional(),
  requireNoUnresolvedCriticalFailure: z.boolean().default(false),
  requirePackagingCompatibilityPassed: z.boolean().default(false),

  requireCostSnapshot: z.boolean().default(false),

  /** Regulatory gates (spec §2.5) — off by default, exactly like every
   *  other requirement above. See `engine/regulatoryApproval.ts`'s
   *  `deriveRegulatoryReadiness`, which is what actually computes these
   *  facts from persisted regulatory rules/findings/reviews. */
  requireRegulatoryClassificationCompleted: z.boolean().default(false),
  requireNoBlockingRegulatoryFinding: z.boolean().default(false),
  requireAllMandatoryDocumentsPresent: z.boolean().default(false),
  requireAllMandatoryEvidencePresent: z.boolean().default(false),
  requireAllRequiredClaimsReviewed: z.boolean().default(false),
  requireHumanRegulatoryReviewCompleted: z.boolean().default(false),

  /** Multi-jurisdiction scope for the six regulatory gates above (spec
   *  §3.3) — none of this changes whether the gates are on, only WHICH
   *  jurisdiction(s) they're evaluated against once they are. Every field
   *  defaults to empty/false, which preserves the original
   *  primary-market-only behavior exactly: nothing here turns a new gate
   *  on by itself. Precedence when more than one is set:
   *  `requiredRegulatoryJurisdictions` (explicit list) >
   *  `requireAllTargetMarketsReviewed` (every one of the formulation's own
   *  `targetMarkets`) > `allowPrimaryMarketOnly` / nothing set (the
   *  formulation's first target market only). See
   *  `engine/regulatoryApproval.ts`'s `resolveRegulatoryJurisdictions`. */
  requiredRegulatoryJurisdictions: z.array(z.enum(REGULATORY_JURISDICTIONS)).optional(),
  requireAllTargetMarketsReviewed: z.boolean().default(false),
  allowPrimaryMarketOnly: z.boolean().default(false),

  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

/**
 * One immutable snapshot of a policy's full field set at the moment it
 * changed — append-only, same "snapshot rather than recompute/overwrite"
 * convention as `FormulationVersion`/`TrialFormulaSnapshot`. `approval_policies`
 * itself stays a mutable "current state" row (so existing scope-resolution
 * and Approval-tab selection code keeps reading it the same way); this is
 * the durable history alongside it.
 */
export const APPROVAL_POLICY_CHANGE_TYPES = ["created", "edited", "activated", "deactivated", "retired", "restored", "cloned_from"] as const;
export type ApprovalPolicyChangeType = (typeof APPROVAL_POLICY_CHANGE_TYPES)[number];

export const approvalPolicyRevisionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  /** The stable lineage id — always equal to the `ApprovalPolicy.id` this
   *  revision belongs to. */
  policyId: z.string().min(1),
  revisionNumber: z.number().int().positive(),
  snapshot: approvalPolicySchema,
  changeType: z.enum(APPROVAL_POLICY_CHANGE_TYPES),
  changeReason: z.string().min(1),
  changedBy: z.string().min(1),
  changedAt: z.string(),
  /** Set only for `changeType: "restored"`. */
  restoredFromRevisionId: z.string().optional(),
  /** Set only for `changeType: "cloned_from"` — the source policy's id. */
  clonedFromPolicyId: z.string().optional(),
});
export type ApprovalPolicyRevision = z.infer<typeof approvalPolicyRevisionSchema>;

export function toLabApprovalPolicy(policy: ApprovalPolicy): LabApprovalPolicy {
  return {
    requireCompletedTrial: policy.requireCompletedTrial,
    requireAllRequiredTestsCompleted: policy.requireAllRequiredTestsCompleted,
    requireAllCriticalTestsPassed: policy.requireAllCriticalTestsPassed,
    requireNoUnresolvedCriticalDeviation: policy.requireNoUnresolvedCriticalDeviation,
    requireNoUnresolvedCriticalCorrectiveAction: policy.requireNoUnresolvedCriticalCorrectiveAction,
  };
}

export function toStabilityApprovalPolicy(policy: ApprovalPolicy): StabilityApprovalPolicy {
  return {
    requireActiveStudy: policy.requireActiveStudy,
    requireInitialTestsPassed: policy.requireInitialTestsPassed,
    minimumRequiredTimePoints: policy.minimumRequiredTimePoints,
    requireNoUnresolvedCriticalFailure: policy.requireNoUnresolvedCriticalFailure,
    requirePackagingCompatibilityPassed: policy.requirePackagingCompatibilityPassed,
  };
}

/** Does this policy apply to a given product family / packaging SKU? Empty
 *  policy arrays mean unrestricted, same convention as test applicability. */
export function policyApplies(policy: ApprovalPolicy, productFamilyCode: string, packagingSkuCode?: string): boolean {
  if (policy.productFamilyCodes.length && !policy.productFamilyCodes.includes(productFamilyCode)) return false;
  if (packagingSkuCode && policy.packagingSkuCodes.length && !policy.packagingSkuCodes.includes(packagingSkuCode)) return false;
  return true;
}

/** A structured signal that policy resolution was ambiguous — never
 *  silently merged or arbitrarily picked. The caller (the Approval panel)
 *  renders this as a blocker requiring an explicit human policy choice. */
export interface PolicyConflict {
  targetStatus: ApprovalPolicyTargetStatus;
  productFamilyCode: string;
  packagingSkuCode?: string;
  matchingPolicyIds: string[];
  reason: string;
}

export interface PolicyResolution {
  resolved?: ApprovalPolicy;
  conflict?: PolicyConflict;
}

/** How specifically a policy is scoped — used only to rank candidates
 *  against each other, never exposed as a standalone score. */
function specificity(policy: ApprovalPolicy): number {
  const familyExact = policy.productFamilyCodes.length > 0;
  const skuExact = policy.packagingSkuCodes.length > 0;
  if (familyExact && skuExact) return 4; // exact family + exact SKU
  if (familyExact) return 3; // exact family
  if (skuExact) return 2; // exact SKU
  return 1; // global
}

/**
 * Deterministically resolve which active, non-retired policy applies —
 * spec: "define and document precedence" rather than merge conflicting
 * policies silently. Order: exact family+SKU > exact family > exact SKU >
 * global; ties broken by an explicit `priority` (higher wins), then by the
 * most recent `effectiveDate`; a remaining tie is reported as a
 * `PolicyConflict`, never guessed.
 */
export function resolvePolicyPrecedence(
  policies: ApprovalPolicy[],
  targetStatus: ApprovalPolicyTargetStatus,
  productFamilyCode: string,
  packagingSkuCode?: string,
): PolicyResolution {
  const candidates = policies.filter(
    (p) => p.active && !p.retired && p.targetStatus === targetStatus && policyApplies(p, productFamilyCode, packagingSkuCode),
  );
  if (candidates.length === 0) return {};
  if (candidates.length === 1) return { resolved: candidates[0] };

  const maxSpecificity = Math.max(...candidates.map(specificity));
  let tier = candidates.filter((p) => specificity(p) === maxSpecificity);
  if (tier.length === 1) return { resolved: tier[0] };

  const withPriority = tier.filter((p) => p.priority !== undefined);
  if (withPriority.length > 0) {
    const maxPriority = Math.max(...withPriority.map((p) => p.priority as number));
    const byPriority = tier.filter((p) => p.priority === maxPriority);
    if (byPriority.length === 1) return { resolved: byPriority[0] };
    tier = byPriority;
  }

  const withDate = tier.filter((p) => p.effectiveDate);
  if (withDate.length > 0) {
    const latestDate = withDate.reduce((latest, p) => (p.effectiveDate! > latest ? p.effectiveDate! : latest), withDate[0].effectiveDate!);
    const byDate = tier.filter((p) => p.effectiveDate === latestDate);
    if (byDate.length === 1) return { resolved: byDate[0] };
    tier = byDate;
  }

  return {
    conflict: {
      targetStatus,
      productFamilyCode,
      packagingSkuCode,
      matchingPolicyIds: tier.map((p) => p.id),
      reason: `${tier.length} active polic${tier.length === 1 ? "y matches" : "ies match"} "${productFamilyCode}"${packagingSkuCode ? `/"${packagingSkuCode}"` : ""} for ${targetStatus} with equal specificity, priority and effective date.`,
    },
  };
}
