// Phase 13 Session 4 — the one accessor every privileged command wrapper
// (`lib/formulations.ts`, `lib/masterdata.ts`, `lib/tauri.ts`'s backup/
// migration/data-location/automatic-backup functions, etc.) uses to attach
// the caller's bearer token to a Tauri `invoke()` call.
//
// This does NOT make the frontend a source of authority — it never has
// been, and still isn't: the Rust command that receives this token
// re-validates it against `identity.db` on every single call
// (`authz::authorize`/`authz::current_actor`, architecture doc §9.3) and
// derives the acting role from the stored `users` row that session resolves
// to, never from anything the frontend claims about itself. Reading a
// plausible-looking string out of localStorage and sending it is exactly as
// authoritative as sending no token at all if the backend didn't re-check
// it — the guarantee lives entirely on the Rust side.
//
// Reads the exact key `AuthProvider.tsx` persists to (`SESSION_TOKEN_KEY`,
// exported from there) rather than a second hardcoded string, so the two
// can never drift apart.
import { SESSION_TOKEN_KEY } from "@/app/providers/AuthProvider";

/** The current session's bearer token, or `""` when there isn't one (no
 *  `window` — SSR/test — or nothing persisted yet, e.g. mid-bootstrap).
 *  Callers pass this straight through to `invoke(..., { token, ... })`;
 *  an empty string is simply an invalid token as far as the backend is
 *  concerned, resolving to "not authorized" like any other bad token — not
 *  a special case this function needs to guard against itself. */
export function currentSessionToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SESSION_TOKEN_KEY) ?? "";
}
