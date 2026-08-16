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
  | { kind: "system"; reason: string }
  /**
   * A file bringing formulas in from a spreadsheet or another system. Even when
   * the source file says "approved", that claim carries no authority here: the
   * signature was given somewhere FormuLab cannot audit, so it must be granted
   * again, by a person, inside FormuLab.
   */
  | { kind: "import"; source: string };

/**
 * Phase 13 Session 1 — the fixed 12-role enterprise model (superseded the
 * original 6-role set: `chemist` was folded into `researcher`, and
 * `quality`/`production` each split into an employee tier plus a manager
 * tier that alone holds approval authority). See
 * docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md §1 for the full role
 * intent and §9 for exactly how APPROVAL_AUTHORITY below was re-derived.
 */
export const APPROVAL_ROLES = [
  "researcher",
  "research_manager",
  "quality",
  "quality_manager",
  "regulatory",
  "raw_material",
  "procurement",
  "production_engineering",
  "production",
  "production_manager",
  "document_control",
  "administrator",
] as const;
export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

/**
 * Which roles may sign off which approval gate.
 *
 * Deliberately manager-tier only for `pilot_approved`/`production_approved`:
 * a worker completing their own work (researcher, quality, production) must
 * never be able to grant the approval that's supposed to be their manager's
 * sign-off — that would silently reintroduce self-approval under a new role
 * name. `administrator` keeps broad approval authority (a user-approved,
 * explicit exception, so IT can exercise every workflow gate while testing)
 * and `regulatory` keeps its own authority unsplit (Phase 13 keeps
 * Regulatory as one fixed role, not employee/manager tiers).
 */
export const APPROVAL_AUTHORITY: Record<FormulaStatus, readonly ApprovalRole[]> = {
  pilot_approved: ["research_manager", "quality_manager", "administrator"],
  production_approved: ["quality_manager", "regulatory", "production_manager", "administrator"],
  // Everything else is a working state, not an approval.
  concept: [],
  literature_candidate: [],
  chemist_review: [],
  lab_candidate: [],
  stability_testing: [],
  pilot_candidate: [],
  retired: ["research_manager", "quality_manager", "administrator"],
  rejected: ["research_manager", "quality_manager", "regulatory", "administrator"],
};

/**
 * Phase 13 Session 4: exported (was module-private) so
 * `scripts/generate-role-policy-matrix.ts` can serialize it to
 * `formulaStatusTransitions.json` — the shared fixture `role_policy.rs`
 * (Rust) reads to give `save_approval_record` a real, non-duplicated
 * workflow-transition-validity check server-side (architecture doc §9.3).
 * Widening this from `const` to `export const` changes nothing about its
 * behavior or any existing caller.
 */
export const ALLOWED_NEXT: Record<FormulaStatus, readonly FormulaStatus[]> = {
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
    | "APPROVAL_RECORD_REQUIRED"
    | "NOT_READY_FOR_APPROVAL";
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
