// Phase 13 Session 2 — thin bridge to the Rust `auth` module (bootstrap,
// login, logout, session validation). Mirrors the pattern every other
// desktop-only command wrapper in `lib/tauri.ts` uses: a no-op/throwing
// fallback outside Tauri so `pnpm dev` in a plain browser still runs.
//
// The frontend never sends a role, user id, or approval authority to any
// of these — every function below only ever sends what a human typed
// (username/password) or an opaque session token issued by Rust.
import { isTauri } from "./tauri";

/** The safe, non-secret projection of a user record — never a password or
 *  its hash. This is the shape the authenticated UserContext is built
 *  from; it is identity/session context, not a permissions array. */
export interface SafeUser {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  accountStatus: string;
  mustChangePassword: boolean;
}

export interface AuthSession {
  user: SafeUser;
  token: string;
  expiresAt: string;
}

export interface BootstrapStatusResult {
  bootstrapRequired: boolean;
}

/** Whether a fresh install still needs its first Administrator created.
 *  Outside Tauri (plain browser dev), reports bootstrap NOT required so
 *  the auth gate falls through to Login rather than blocking `pnpm dev`
 *  on a screen with no backend behind it. */
export async function bootstrapStatus(): Promise<BootstrapStatusResult> {
  if (!isTauri) return { bootstrapRequired: false };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BootstrapStatusResult>("bootstrap_status");
}

/** Creates the first (and only ever bootstrap-created) Administrator.
 *  Throws the backend's error message on failure — including the
 *  permanent "an administrator already exists" refusal after the first
 *  successful call, from anywhere, ever. */
export async function bootstrapCreateAdministrator(input: {
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
}): Promise<AuthSession> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AuthSession>("bootstrap_create_administrator", {
    username: input.username,
    displayName: input.displayName,
    password: input.password,
    confirmPassword: input.confirmPassword,
  });
}

/** Username/password login. On failure throws the one generic message
 *  ("Invalid username or password.") for every failure shape — unknown
 *  username, wrong password, disabled account, or temporary lockout are
 *  all indistinguishable here by design. */
export async function login(username: string, password: string): Promise<AuthSession> {
  if (!isTauri) throw new Error("not running in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AuthSession>("login", { username, password });
}

/** Revokes the session backend-side. Never throws for an already-invalid
 *  token (logging out twice, or after the session already expired, is a
 *  normal no-op) — callers should still always clear local state after
 *  calling this regardless of the promise settling. */
export async function logout(token: string): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("logout", { token });
}

/** Resolves a persisted session token to its current, live user record —
 *  or `null` if it's missing/expired/idle-timed-out/revoked/the account
 *  was disabled/the user no longer exists. Used on startup to decide
 *  whether a persisted token still means "authenticated" and, while
 *  authenticated, to refresh role/status without re-prompting for a
 *  password (e.g. after an administrator changes this user's role). */
export async function currentSession(token: string): Promise<SafeUser | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SafeUser | null>("current_session", { token });
}
