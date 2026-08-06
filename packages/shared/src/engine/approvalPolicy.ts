/**
 * Approval-policy lifecycle: create, edit, activate/deactivate, retire,
 * clone, restore a prior revision — every one of them human-gated and
 * every one of them appending an immutable `ApprovalPolicyRevision` rather
 * than quietly overwriting what the policy used to say.
 *
 * `approval_policies` (the mutable "current state" row) and
 * `approval_policy_revisions` (append-only) are two different Rust
 * collections; this module only builds the two records a caller then
 * persists together — it never touches storage itself.
 */
import { newId } from "./versioning";
import type { Actor } from "../schemas/status";
import type { ApprovalPolicy, ApprovalPolicyChangeType, ApprovalPolicyRevision } from "../schemas/approvalPolicy";

export interface PolicyChangeResult {
  policy: ApprovalPolicy;
  revision: ApprovalPolicyRevision;
}

function requireHuman(actor: Actor, action: string): asserts actor is Actor & { kind: "human" } {
  if (actor.kind !== "human") {
    throw new Error(`Only a human may ${action} an approval policy.`);
  }
}

function requireReason(reason: string, action: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new Error(`A reason is required to ${action} an approval policy.`);
  }
  return trimmed;
}

function buildRevision(
  policy: ApprovalPolicy,
  changeType: ApprovalPolicyChangeType,
  changeReason: string,
  actor: Actor & { kind: "human" },
  now: string,
  extra: Partial<Pick<ApprovalPolicyRevision, "restoredFromRevisionId" | "clonedFromPolicyId">> = {},
): ApprovalPolicyRevision {
  return {
    schemaVersion: "1.0",
    id: newId("policyrev"),
    policyId: policy.id,
    revisionNumber: policy.revisionNumber,
    snapshot: policy,
    changeType,
    changeReason,
    changedBy: actor.userId,
    changedAt: now,
    ...extra,
  };
}

/** The first revision, recorded at creation. */
export function initialPolicyRevision(policy: ApprovalPolicy, actor: Actor): ApprovalPolicyRevision {
  requireHuman(actor, "create");
  return buildRevision({ ...policy, revisionNumber: 1 }, "created", "Created.", actor, policy.createdAt);
}

/** Edit any of a policy's own fields (not its lifecycle flags — use the
 *  dedicated functions below for those, so every change type is
 *  distinguishable in the revision history). */
export function editPolicy(
  current: ApprovalPolicy,
  updates: Partial<Omit<ApprovalPolicy, "id" | "schemaVersion" | "createdBy" | "createdAt" | "revisionNumber" | "retired">>,
  actor: Actor,
  changeReason: string,
): PolicyChangeResult {
  requireHuman(actor, "edit");
  const reason = requireReason(changeReason, "edit");
  if (current.retired) {
    throw new Error(`Policy "${current.name}" is retired and cannot be edited — clone it or restore a prior revision instead.`);
  }
  const now = new Date().toISOString();
  const policy: ApprovalPolicy = { ...current, ...updates, revisionNumber: current.revisionNumber + 1, updatedBy: actor.userId, updatedAt: now };
  return { policy, revision: buildRevision(policy, "edited", reason, actor, now) };
}

export function setPolicyActive(current: ApprovalPolicy, active: boolean, actor: Actor, changeReason = ""): PolicyChangeResult {
  requireHuman(actor, active ? "activate" : "deactivate");
  if (current.retired) {
    throw new Error(`Policy "${current.name}" is retired and cannot be reactivated — clone it or restore a prior revision instead.`);
  }
  const now = new Date().toISOString();
  const policy: ApprovalPolicy = { ...current, active, revisionNumber: current.revisionNumber + 1, updatedBy: actor.userId, updatedAt: now };
  const reason = changeReason.trim() || (active ? "Activated." : "Deactivated.");
  return { policy, revision: buildRevision(policy, active ? "activated" : "deactivated", reason, actor, now) };
}

/** Terminal. A retired policy can never be reactivated directly — cloning
 *  or restoring an old revision are the only ways back, both of which
 *  create a distinct, fresh, inactive-by-default record. */
export function retirePolicy(current: ApprovalPolicy, actor: Actor, changeReason: string): PolicyChangeResult {
  requireHuman(actor, "retire");
  const reason = requireReason(changeReason, "retire");
  const now = new Date().toISOString();
  const policy: ApprovalPolicy = { ...current, active: false, retired: true, revisionNumber: current.revisionNumber + 1, updatedBy: actor.userId, updatedAt: now };
  return { policy, revision: buildRevision(policy, "retired", reason, actor, now) };
}

/** A brand-new, independent policy (its own id and revision history)
 *  seeded from `source`'s current fields. Never active — turning a clone
 *  on is a deliberate, separate act. */
export function clonePolicy(source: ApprovalPolicy, actor: Actor, newName: string): PolicyChangeResult {
  requireHuman(actor, "clone");
  const now = new Date().toISOString();
  const policy: ApprovalPolicy = {
    ...source,
    id: newId("policy"),
    name: newName.trim() || `${source.name} (copy)`,
    active: false,
    retired: false,
    revisionNumber: 1,
    createdBy: actor.userId,
    createdAt: now,
    updatedBy: undefined,
    updatedAt: now,
  };
  const revision = buildRevision(policy, "cloned_from", `Cloned from "${source.name}".`, actor, now, { clonedFromPolicyId: source.id });
  return { policy, revision };
}

/**
 * Apply a historical revision's field values as a NEW revision on top of
 * the current policy — restoring never rewrites or deletes the revisions
 * that came after the one being restored; it adds one more on top, the
 * same "restore loads a new draft, the old record stays untouched"
 * principle `FORMULA_VERSIONING.md` already documents for formula versions.
 */
export function restorePolicyRevision(current: ApprovalPolicy, revisionToRestore: ApprovalPolicyRevision, actor: Actor): PolicyChangeResult {
  requireHuman(actor, "restore a revision of");
  if (revisionToRestore.policyId !== current.id) {
    throw new Error(`Revision ${revisionToRestore.id} does not belong to policy "${current.name}".`);
  }
  const now = new Date().toISOString();
  const policy: ApprovalPolicy = {
    ...revisionToRestore.snapshot,
    id: current.id,
    retired: false,
    revisionNumber: current.revisionNumber + 1,
    createdBy: current.createdBy,
    createdAt: current.createdAt,
    updatedBy: actor.userId,
    updatedAt: now,
  };
  const revision = buildRevision(policy, "restored", `Restored from revision ${revisionToRestore.revisionNumber}.`, actor, now, {
    restoredFromRevisionId: revisionToRestore.id,
  });
  return { policy, revision };
}
