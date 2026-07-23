/**
 * Formula version lifecycle: retire, reject, reopen — without ever rewriting
 * a saved version file.
 *
 * A version's `status` field is what it was when saved. Retiring or
 * rejecting it later is a status CHANGE, and versions are immutable, so the
 * change is recorded the same way every other status-relevant fact about a
 * version already is: as an audit event (`audit.jsonl`, append-only). A
 * version's true current status is therefore not `version.status` alone —
 * it is `version.status` overridden by the latest lifecycle event for that
 * version id, if any. This reuses the existing audit-log mechanism rather
 * than inventing a second, parallel status-history file.
 */
import { canTransitionTo, type Actor, type TransitionResult } from "../schemas/status";
import { canTransitionWithReadiness, type ApprovalReadiness } from "./approvalReadiness";
import type { AuditEvent } from "../schemas/formulation";
import type { FormulaStatus, FormulationVersion } from "../schemas/formulation";

/** Audit `action` values that represent a lifecycle status change, mapped to
 *  the status they move the version to. `version.approved.*` reuses exactly
 *  this same mechanism for `pilot_approved`/`production_approved` — an
 *  approval is a status change like any other, recorded as an audit event
 *  rather than by editing the immutable version file. See
 *  `attemptApprovalTransition` below and docs/APPROVAL_WORKFLOW.md. */
const LIFECYCLE_ACTIONS: Record<string, FormulaStatus> = {
  "version.retired": "retired",
  "version.rejected": "rejected",
  "version.reopened": "concept",
  "version.approved.pilot_approved": "pilot_approved",
  "version.approved.production_approved": "production_approved",
};

/**
 * A version's current status: its saved `status`, overridden by the latest
 * lifecycle audit event that targets it, if any exist.
 */
export function effectiveStatus(version: FormulationVersion, auditEvents: AuditEvent[]): FormulaStatus {
  const relevant = auditEvents
    .filter((e) => e.versionId === version.id && e.action in LIFECYCLE_ACTIONS)
    .sort((a, b) => a.at.localeCompare(b.at));
  const last = relevant[relevant.length - 1];
  return last ? LIFECYCLE_ACTIONS[last.action] : version.status;
}

export interface LifecycleTransitionResult {
  allowed: boolean;
  action?: "version.retired" | "version.rejected" | "version.reopened" | "version.approved.pilot_approved" | "version.approved.production_approved";
  message?: string;
  code?: TransitionResult["code"];
}

/**
 * Attempt to retire, reject or reopen a version. Goes through the same
 * `canTransitionTo` actor/role gate as every other status change — an
 * agent, system or import actor is refused here exactly as it would be
 * refused an approval, because retiring/rejecting is still a workflow
 * status this platform tracks for audit purposes, not a free-form edit.
 */
export function attemptLifecycleTransition(
  currentStatus: FormulaStatus,
  to: "retired" | "rejected" | "concept",
  actor: Actor,
): LifecycleTransitionResult {
  const check = canTransitionTo(currentStatus, to, actor);
  if (!check.allowed) {
    return { allowed: false, message: check.message };
  }
  const action = to === "retired" ? "version.retired" : to === "rejected" ? "version.rejected" : "version.reopened";
  return { allowed: true, action };
}

/**
 * Attempt to grant `pilot_approved`/`production_approved`. The single call
 * site the desktop approval action goes through: actor/role authority AND
 * content readiness together (`canTransitionWithReadiness`), never
 * `canTransitionTo` alone. Returns an `action` that plugs into the same
 * `LIFECYCLE_ACTIONS`/`effectiveStatus` mechanism as retire/reject/reopen —
 * there is no separate, parallel approval-status mechanism.
 */
export function attemptApprovalTransition(
  currentStatus: FormulaStatus,
  to: "pilot_approved" | "production_approved",
  actor: Actor,
  readiness: ApprovalReadiness,
  opts: { hasApprovalRecord?: boolean } = {},
): LifecycleTransitionResult {
  const check = canTransitionWithReadiness(currentStatus, to, actor, readiness, opts);
  if (!check.allowed) {
    return { allowed: false, message: check.message, code: check.code };
  }
  const action = to === "pilot_approved" ? "version.approved.pilot_approved" : "version.approved.production_approved";
  return { allowed: true, action };
}
