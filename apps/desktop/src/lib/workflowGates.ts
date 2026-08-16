/**
 * Phase 13 closure session — thin bridge to the Rust `workflow_gates`
 * module: the four Production Manager gates (`raw_material_verification`,
 * `supplier_document_verification`, `production_engineering_handoff`,
 * `production_release`). Every command is authorized and subject-validated
 * server-side (`authz::authorize_app` + `validate_subject_exists`,
 * `workflow_gates.rs`) — this file never decides who may submit/decide a
 * gate or whether a subject is real, it only forwards what the UI collected
 * plus the opaque bearer token every other privileged command already
 * attaches (`sessionToken.ts`). Frontend gating (hiding a submit/decide
 * button) is UX only; the backend remains authoritative.
 */
import { isTauri } from "./tauri";
import { currentSessionToken } from "./sessionToken";

export type WorkflowGateType =
  | "raw_material_verification"
  | "supplier_document_verification"
  | "production_engineering_handoff"
  | "production_release";

export interface GateTransition {
  id: string;
  from: string;
  to: string;
  actorUserId: string;
  actorRole: string;
  actorDisplayName: string;
  at: string;
  reason: string | null;
}

export interface WorkflowGateRecord {
  schemaVersion: string;
  id: string;
  gateType: string;
  subjectId: string;
  parentId: string | null;
  state: "pending" | "submitted" | "approved" | "rejected";
  submittedBy: string | null;
  submittedByRole: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedByRole: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedByRole: string | null;
  rejectedAt: string | null;
  reason: string | null;
  history: GateTransition[];
  createdAt: string;
  updatedAt: string;
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, { token: currentSessionToken(), ...args });
}

export async function readWorkflowGate(
  gateType: WorkflowGateType,
  subjectId: string,
  parentId?: string,
): Promise<WorkflowGateRecord | null> {
  if (!isTauri) return null;
  return call<WorkflowGateRecord | null>("read_workflow_gate", { gateType, subjectId, parentId });
}

export async function submitWorkflowGate(
  gateType: WorkflowGateType,
  subjectId: string,
  parentId?: string,
  reason?: string,
): Promise<WorkflowGateRecord> {
  return call<WorkflowGateRecord>("submit_workflow_gate", { gateType, subjectId, parentId, reason });
}

export async function decideWorkflowGate(
  gateType: WorkflowGateType,
  subjectId: string,
  decision: "approved" | "rejected",
  parentId?: string,
  reason?: string,
): Promise<WorkflowGateRecord> {
  return call<WorkflowGateRecord>("decide_workflow_gate", { gateType, subjectId, parentId, decision, reason });
}
