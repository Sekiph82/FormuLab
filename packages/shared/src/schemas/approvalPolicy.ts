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

export const APPROVAL_POLICY_TARGET_STATUSES = ["pilot_approved", "production_approved"] as const;
export type ApprovalPolicyTargetStatus = (typeof APPROVAL_POLICY_TARGET_STATUSES)[number];

export const approvalPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  name: z.string().min(1),
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

  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

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
