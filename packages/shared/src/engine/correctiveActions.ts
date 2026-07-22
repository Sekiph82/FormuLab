/**
 * Corrective-action lifecycle — shared by Laboratory Trials and Stability
 * Studies. `effective`/`ineffective` are reachable only through a recorded
 * effectiveness check by a named human; nothing else can set them, the same
 * way a `TrialDeviation`'s `resolved` status requires an actual resolution.
 */
import { newId, draftFromVersion } from "./versioning";
import type { Actor } from "../schemas/status";
import type { FormulationDraft, FormulationVersion } from "../schemas/formulation";
import type {
  CorrectiveAction,
  CorrectiveActionSourceType,
  CorrectiveActionType,
} from "../schemas/correctiveActions";

function audit(action: CorrectiveAction, event: string, actor: Actor, detail?: string): CorrectiveAction {
  return {
    ...action,
    auditHistory: [
      ...action.auditHistory,
      {
        action: event,
        actorId: actor.kind === "human" ? actor.userId : actor.kind === "agent" ? actor.runId : actor.kind === "system" ? actor.reason : actor.source,
        actorKind: actor.kind,
        at: new Date().toISOString(),
        detail,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export interface CreateCorrectiveActionInput {
  projectId: string;
  sourceType: CorrectiveActionSourceType;
  sourceRecordId: string;
  deviationOrFailureId?: string;
  title: string;
  problemStatement: string;
  actionType: CorrectiveActionType;
  owner: string;
  dueDate?: string;
}

export function createCorrectiveAction(input: CreateCorrectiveActionInput, actor: Actor): CorrectiveAction {
  const now = new Date().toISOString();
  const base: CorrectiveAction = {
    schemaVersion: "1.0",
    id: newId("capa"),
    code: newId("CAPA"),
    projectId: input.projectId,
    sourceType: input.sourceType,
    sourceRecordId: input.sourceRecordId,
    deviationOrFailureId: input.deviationOrFailureId,
    title: input.title,
    problemStatement: input.problemStatement,
    actionType: input.actionType,
    owner: input.owner,
    dueDate: input.dueDate,
    status: "open",
    auditHistory: [],
    createdAt: now,
    createdBy: actor.kind === "human" ? actor.userId : "local",
    updatedAt: now,
  };
  return audit(base, "corrective_action.created", actor, input.title);
}

export function assignOwner(action: CorrectiveAction, owner: string, actor: Actor): CorrectiveAction {
  return audit({ ...action, owner }, "corrective_action.owner_assigned", actor, owner);
}

export function markInProgress(action: CorrectiveAction, actor: Actor): CorrectiveAction {
  if (action.status !== "open") {
    throw new Error(`Corrective action ${action.code} must be open to move to in_progress (is ${action.status}).`);
  }
  return audit({ ...action, status: "in_progress" }, "corrective_action.in_progress", actor);
}

/** "Mark completed" (spec §8) — moves to `awaiting_verification`, not
 *  straight to `effective`: nothing is "done" until a human verifies the
 *  fix actually worked. */
export function markAwaitingVerification(action: CorrectiveAction, resolution: string, actor: Actor): CorrectiveAction {
  if (action.status !== "in_progress" && action.status !== "open") {
    throw new Error(`Corrective action ${action.code} cannot move to awaiting_verification from ${action.status}.`);
  }
  return audit({ ...action, status: "awaiting_verification", resolution }, "corrective_action.awaiting_verification", actor, resolution);
}

export interface VerifyEffectivenessInput {
  effective: boolean;
  notes?: string;
}

/** The only path to `effective`/`ineffective` — requires a human actor. */
export function verifyEffectiveness(action: CorrectiveAction, actor: Actor, input: VerifyEffectivenessInput): CorrectiveAction {
  if (actor.kind !== "human") {
    throw new Error("Only a human may verify a corrective action's effectiveness.");
  }
  if (action.status !== "awaiting_verification") {
    throw new Error(`Corrective action ${action.code} must be awaiting_verification to record an effectiveness check (is ${action.status}).`);
  }
  const now = new Date().toISOString();
  const updated: CorrectiveAction = {
    ...action,
    status: input.effective ? "effective" : "ineffective",
    effectivenessCheck: { checkedBy: actor.userId, checkedAt: now, effective: input.effective, notes: input.notes },
    closedBy: input.effective ? actor.userId : action.closedBy,
    closedAt: input.effective ? now : action.closedAt,
  };
  return audit(updated, "corrective_action.effectiveness_verified", actor, input.effective ? "effective" : "ineffective");
}

export function reopenCorrectiveAction(action: CorrectiveAction, actor: Actor, reason: string): CorrectiveAction {
  if (action.status !== "ineffective" && action.status !== "effective") {
    throw new Error(`Corrective action ${action.code} can only be reopened from effective/ineffective (is ${action.status}).`);
  }
  return audit(
    { ...action, status: "in_progress", closedBy: undefined, closedAt: undefined, effectivenessCheck: undefined },
    "corrective_action.reopened",
    actor,
    reason,
  );
}

export function cancelCorrectiveAction(action: CorrectiveAction, actor: Actor, reason: string): CorrectiveAction {
  return audit({ ...action, status: "cancelled" }, "corrective_action.cancelled", actor, reason);
}

export interface DraftFromCorrectiveActionResult {
  draft: FormulationDraft;
  action: CorrectiveAction;
}

/**
 * Create a new working draft from a corrective action — the ONLY path this
 * module offers from "we found a problem" to "here's a formula to try
 * instead." Never mutates `sourceVersion` (the same `draftFromVersion`
 * every other restore/clone path uses), never sets an approval status (a
 * `FormulationDraft` has none to set), and links back to the action so the
 * lineage survives. The caller is expected to `appendAudit` on the
 * formulation project the same way `FormulasPage.tsx` already does for a
 * version restore — this function only builds the records.
 */
export function createDraftFromCorrectiveAction(
  action: CorrectiveAction,
  sourceVersion: FormulationVersion,
): DraftFromCorrectiveActionResult {
  const draft = draftFromVersion(sourceVersion);
  const updatedAction: CorrectiveAction = {
    ...action,
    createdDraftId: sourceVersion.formulationId,
    updatedAt: new Date().toISOString(),
  };
  return { draft, action: updatedAction };
}
