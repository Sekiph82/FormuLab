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
  "version.advanced.literature_candidate": "literature_candidate",
  "version.advanced.chemist_review": "chemist_review",
  "version.advanced.lab_candidate": "lab_candidate",
  "version.advanced.stability_testing": "stability_testing",
  "version.advanced.pilot_candidate": "pilot_candidate",
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

/** The pre-approval pipeline stages, in the single canonical order this UI
 *  advances a version through. `concept` can also reach `literature_candidate`
 *  directly (`ALLOWED_NEXT`), but that branch is an optional side-step, not
 *  required to reach `pilot_candidate` — the single "Advance" button in the
 *  Versions tab always offers this one path so there is exactly one obvious
 *  next action, never a branching choice for a routine checkpoint. */
export type StageAdvanceStatus = "literature_candidate" | "chemist_review" | "lab_candidate" | "stability_testing" | "pilot_candidate";

export const STAGE_ADVANCE_NEXT: Partial<Record<FormulaStatus, StageAdvanceStatus>> = {
  concept: "chemist_review",
  literature_candidate: "chemist_review",
  chemist_review: "lab_candidate",
  lab_candidate: "stability_testing",
  stability_testing: "pilot_candidate",
};

export interface StageAdvanceResult {
  allowed: boolean;
  action?: `version.advanced.${StageAdvanceStatus}`;
  message?: string;
  code?: TransitionResult["code"];
}

/**
 * Advance a version one step through the pre-approval pipeline (`concept` ->
 * ... -> `pilot_candidate`). Each stage is a working-state checkpoint, not an
 * approval — gated by `canTransitionTo` alone, exactly like retire/reject/
 * reopen above, with no readiness check and no approval record required.
 * None of these five statuses are in `HUMAN_ONLY_STATUSES`, so an agent or
 * system actor may advance a stage too; only `pilot_approved`/
 * `production_approved` require a human with authority
 * (`attemptApprovalTransition`).
 */
export function attemptStageAdvance(currentStatus: FormulaStatus, to: StageAdvanceStatus, actor: Actor): StageAdvanceResult {
  const check = canTransitionTo(currentStatus, to, actor);
  if (!check.allowed) {
    return { allowed: false, message: check.message, code: check.code };
  }
  return { allowed: true, action: `version.advanced.${to}` };
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
