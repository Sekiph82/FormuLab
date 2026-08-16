/**
 * Phase 13 Session 5 — thin bridge to the Rust `admin` module
 * (`Administration → Users`). Every command is authorized server-side from
 * the caller's session token (`authz::authorize`, architecture doc §9.3.3)
 * — this file never sends a role/permission claim, only what an
 * administrator typed, plus the opaque bearer token every other privileged
 * command wrapper already attaches (`sessionToken.ts`).
 */
import { isTauri } from "./tauri";
import { currentSessionToken } from "./sessionToken";
import type { SafeUser } from "./auth";

export type { SafeUser };

export interface SecurityAuditEvent {
  id: number;
  at: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  outcome: string;
  detail: string | null;
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, { token: currentSessionToken(), ...args });
}

export async function listAdministeredUsers(): Promise<SafeUser[]> {
  if (!isTauri) return [];
  return call<SafeUser[]>("list_administered_users");
}

export async function createAdministeredUser(input: {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  role: string;
  department?: string;
  employeeReference?: string;
}): Promise<SafeUser> {
  return call<SafeUser>("create_administered_user", input);
}

export async function updateAdministeredUserProfile(input: {
  userId: string;
  displayName: string;
  department?: string;
  employeeReference?: string;
}): Promise<SafeUser> {
  return call<SafeUser>("update_administered_user_profile", input);
}

export async function changeAdministeredUserRole(userId: string, role: string): Promise<SafeUser> {
  return call<SafeUser>("change_administered_user_role", { userId, role });
}

export async function setAdministeredUserAccountStatus(userId: string, active: boolean): Promise<SafeUser> {
  return call<SafeUser>("set_administered_user_account_status", { userId, active });
}

export async function resetAdministeredUserPassword(
  userId: string,
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  await call<void>("reset_administered_user_password", { userId, newPassword, confirmPassword });
}

export async function readSecurityAuditHistory(targetUserId?: string): Promise<SecurityAuditEvent[]> {
  if (!isTauri) return [];
  return call<SecurityAuditEvent[]>("read_security_audit_history", { targetUserId });
}
