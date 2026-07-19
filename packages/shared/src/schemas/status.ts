/**
 * Formula status transitions, and the rule that no automated actor may approve
 * a formula.
 *
 * This is enforced here rather than in the UI because "the button was hidden"
 * is not a safety property. Anything that changes status — an agent run, an
 * import, a script — goes through `canTransitionTo`.
 */
import {
  HUMAN_ONLY_STATUSES,
  type FormulaStatus,
} from "./formulation";

/** Who is attempting the change. */
export type Actor =
  | { kind: "human"; role: ApprovalRole; userId: string }
  | { kind: "agent"; runId: string }
  | { kind: "system"; reason: string };

export const APPROVAL_ROLES = [
  "researcher",
  "chemist",
  "quality",
  "regulatory",
  "production",
  "administrator",
] as const;
export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

/** Which roles may sign off which approval gate. */
export const APPROVAL_AUTHORITY: Record<FormulaStatus, readonly ApprovalRole[]> = {
  pilot_approved: ["chemist", "quality", "administrator"],
  production_approved: ["quality", "regulatory", "production", "administrator"],
  // Everything else is a working state, not an approval.
  concept: [],
  literature_candidate: [],
  chemist_review: [],
  lab_candidate: [],
  stability_testing: [],
  pilot_candidate: [],
  retired: ["chemist", "quality", "administrator"],
  rejected: ["chemist", "quality", "regulatory", "administrator"],
};

const ALLOWED_NEXT: Record<FormulaStatus, readonly FormulaStatus[]> = {
  concept: ["literature_candidate", "chemist_review", "rejected"],
  literature_candidate: ["chemist_review", "rejected"],
  chemist_review: ["lab_candidate", "concept", "rejected"],
  lab_candidate: ["stability_testing", "chemist_review", "rejected"],
  stability_testing: ["pilot_candidate", "chemist_review", "rejected"],
  pilot_candidate: ["pilot_approved", "stability_testing", "rejected"],
  pilot_approved: ["production_approved", "pilot_candidate", "retired", "rejected"],
  production_approved: ["retired"],
  retired: [],
  rejected: ["concept"],
};

export interface TransitionResult {
  allowed: boolean;
  /** Machine-readable reason, for logs and tests. */
  code?:
    | "NOT_A_VALID_TRANSITION"
    | "APPROVAL_REQUIRES_HUMAN"
    | "ROLE_NOT_AUTHORIZED"
    | "APPROVAL_RECORD_REQUIRED";
  message?: string;
}

/**
 * May `actor` move a formula version from `from` to `to`?
 *
 * The load-bearing rule: an agent or a system process can never reach
 * `pilot_approved` or `production_approved`, whatever the model concluded about
 * the formula's quality. Approval is a human accepting responsibility, and it
 * requires an ApprovalRecord to point at.
 */
export function canTransitionTo(
  from: FormulaStatus,
  to: FormulaStatus,
  actor: Actor,
  opts: { hasApprovalRecord?: boolean } = {},
): TransitionResult {
  if (!ALLOWED_NEXT[from]?.includes(to)) {
    return {
      allowed: false,
      code: "NOT_A_VALID_TRANSITION",
      message: `${from} cannot move directly to ${to}.`,
    };
  }

  if (HUMAN_ONLY_STATUSES.includes(to)) {
    if (actor.kind !== "human") {
      return {
        allowed: false,
        code: "APPROVAL_REQUIRES_HUMAN",
        message:
          `${to} is an approval and must be granted by a person. ` +
          `A generated formulation is a candidate, not an approved product.`,
      };
    }
    if (!APPROVAL_AUTHORITY[to].includes(actor.role)) {
      return {
        allowed: false,
        code: "ROLE_NOT_AUTHORIZED",
        message: `Role "${actor.role}" cannot grant ${to}.`,
      };
    }
    if (!opts.hasApprovalRecord) {
      return {
        allowed: false,
        code: "APPROVAL_RECORD_REQUIRED",
        message: `${to} requires a signed approval record for the audit trail.`,
      };
    }
  }

  return { allowed: true };
}
